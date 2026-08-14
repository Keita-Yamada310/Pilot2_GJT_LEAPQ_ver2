const jsPsych = initJsPsych({
  show_progress_bar: true,
  auto_update_progress_bar: false,
  message_progress_bar: "課題の進捗"
});

const sessionId = jsPsych.randomization.randomID(12);
const sessionStartMs = performance.now();
const sessionStartIso = new Date().toISOString();
let gjtStartMs = null;
let gjtEndMs = null;
let questionnaireStartMs = null;
let leapQEndMs = null;
let exposureEndMs = null;

function cleanText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function isLikelyMobile() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.matchMedia("(pointer: coarse)").matches;
}

function deviceType() {
  if (/iPad|Tablet/i.test(navigator.userAgent)) return "tablet";
  if (isLikelyMobile()) return "mobile";
  return "desktop_or_laptop";
}

jsPsych.data.addProperties({
  session_id: sessionId,
  study: STUDY_NAME,
  jspsych_version: "8.2.3",
  session_start_iso: sessionStartIso,
  user_agent: navigator.userAgent,
  device_type: deviceType(),
  viewport_width: window.innerWidth,
  viewport_height: window.innerHeight,
  screen_width: window.screen.width,
  screen_height: window.screen.height,
  device_pixel_ratio: window.devicePixelRatio || 1,
  language: navigator.language || "",
  touch_points: navigator.maxTouchPoints || 0
});

const timeline = [];

// タブ移動・画面離脱をjsPsychのinteraction dataに記録。
jsPsych.data.addProperties({ interaction_recording_enabled: true });

// 端末情報を明示的に1行保存。
timeline.push({
  type: jsPsychBrowserCheck,
  inclusion_function: () => true,
  data: { phase: "browser_check" }
});

timeline.push({
  type: jsPsychSurveyHtmlForm,
  preamble: `
    <div class="task-card compact-card">
      <h1>英語課題</h1>
      <p>担当者から指定された参加者番号を入力してください。</p>
    </div>`,
  html: `
    <div class="participant-form">
      <label for="participant_id"><strong>参加者番号</strong></label>
      <input id="participant_id" name="participant_id" type="text" required
             autocomplete="off" autocapitalize="none" spellcheck="false"
             pattern="[A-Za-z0-9_-]{1,30}" maxlength="30">
    </div>`,
  button_label: "次へ",
  data: { phase: "participant_info" },
  on_finish: data => {
    const pid = cleanText(data.response.participant_id);
    jsPsych.data.addProperties({
      participant_id: pid
    });
  }
});

// スマホSafariではフルスクリーンの挙動が不安定なため、PC系のみ全画面を試す。
const fullscreenConditional = {
  timeline: [{
    type: jsPsychFullscreen,
    fullscreen_mode: true,
    message: `<div class="task-card compact-card"><p>「全画面で開始」を押してください。</p></div>`,
    button_label: "全画面で開始",
    data: { phase: "fullscreen_start" }
  }],
  conditional_function: () => !isLikelyMobile()
};
timeline.push(fullscreenConditional);

async function saveToDataPipe(csvText, filename) {
  const response = await fetch("https://pipe.jspsych.org/api/data/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      experimentID: DATAPIPE_EXPERIMENT_ID,
      filename,
      data: csvText
    })
  });
  let result = {};
  try { result = await response.json(); } catch (_) {}
  if (!response.ok || result.error) {
    throw new Error(result.message || `DataPipe returned HTTP ${response.status}`);
  }
  return result;
}

// ---------- Binary GJT ----------
timeline.push({
  type: jsPsychInstructions,
  pages: [
    `<div class="task-card instruction-card">
      <h2>英文判断課題（GJT）</h2>
      <p>英文が1文ずつ表示されます。</p>
      <p>英文が英語の文法として<strong>正しい場合は Yes</strong>、<strong>間違っている場合は No</strong>を選んでください。</p>
      <p>画面では、左が <strong>No</strong>、右が <strong>Yes</strong> です。</p>
      <p>キーボードでは、<strong>Aキー＝No</strong>、<strong>Lキー＝Yes</strong> です。</p>
      <p>各文は<strong>10秒以内</strong>に回答してください。</p>
    </div>`,
    `<div class="task-card instruction-card">
      <h2>回答上の注意</h2>
      <p>文の内容ではなく、英語の文法として判断してください。</p>
      <p><strong>No：左のボタン／Aキー</strong>　　<strong>Yes：右のボタン／Lキー</strong></p>
      <p>迷った場合も、どちらか一方を選んでください。</p>
      <p>最初に練習を2問行い、その後${GJT_ITEM_COUNT}問の本課題に進みます。</p>
    </div>`
  ],
  show_clickable_nav: true,
  button_label_previous: "戻る",
  button_label_next: "次へ",
  data: { phase: "gjt_instructions" }
});

const gjtPracticeItems = [
  { practice_id: "GJT-P1", sentence: "The girl waited for the bus.", presented_status: "grammatical" },
  { practice_id: "GJT-P2", sentence: "The boy enjoyed to play football.", presented_status: "ungrammatical" }
];

// Fit a GJT sentence before revealing it.
// Keeping the sentence hidden during measurement prevents visible reflow/jitter
// on iPhone Safari. The minimum remains 13px.
function fitGjtSentenceToOneLine() {
  const el = document.querySelector(".gjt-sentence");
  if (!el) return;

  el.classList.remove("gjt-fit-ready");
  el.style.fontSize = "";

  const minimumSize = 13;
  let size = parseFloat(window.getComputedStyle(el).fontSize);

  // Use whole-pixel steps to reduce subpixel re-layout on mobile Safari.
  while (el.scrollWidth > el.clientWidth && size > minimumSize) {
    size = Math.max(minimumSize, size - 1);
    el.style.fontSize = `${size}px`;
  }

  el.classList.add("gjt-fit-ready");
}

let currentGjtKeyHandler = null;
let currentGjtInputMethod = null;
let currentGjtKey = null;

function removeGjtKeyHandler() {
  if (currentGjtKeyHandler) {
    document.removeEventListener("keydown", currentGjtKeyHandler);
    currentGjtKeyHandler = null;
  }
}

function makeGjtTrial(isPractice = false) {
  return {
    type: jsPsychHtmlButtonResponse,
    stimulus: function() {
      const sentence = jsPsych.evaluateTimelineVariable("sentence");
      const progress = isPractice
        ? "練習"
        : `GJT　${jsPsych.evaluateTimelineVariable("display_number")} / ${GJT_ITEM_COUNT}`;
      return `<div class="task-card gjt-card">
        <div class="task-progress">${progress}</div>
        <div class="gjt-sentence">${sentence}</div>
        <div class="timeout-note">10秒以内に選んでください。</div>
      </div>`;
    },
    choices: ["No", "Yes"],
    button_layout: "flex",
    button_html: (choice, choiceIndex) =>
      `<button class="jspsych-btn gjt-choice ${choiceIndex === 0 ? "choice-no" : "choice-yes"}"
        data-choice="${choiceIndex}" aria-label="${choiceIndex === 0 ? "No：文法として間違い" : "Yes：文法として正しい"}">
        <span class="gjt-choice-label">${choice}</span>
        <span class="gjt-key-hint">${choiceIndex === 0 ? "A" : "L"}</span>
      </button>`,
    trial_duration: GJT_TRIAL_DURATION_MS,
    on_load: function() {
      currentGjtInputMethod = null;
      currentGjtKey = null;
      removeGjtKeyHandler();

      // Measure after the trial DOM has been laid out, then reveal once.
      // A single requestAnimationFrame avoids a second visible resize.
      window.requestAnimationFrame(fitGjtSentenceToOneLine);

      const buttons = document.querySelectorAll(".binary-gjt .gjt-choice");
      buttons.forEach((button) => {
        button.addEventListener("pointerdown", () => {
          currentGjtInputMethod = "button";
          currentGjtKey = null;
        }, { once: true });
      });

      currentGjtKeyHandler = function(event) {
        if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
        const key = String(event.key || "").toLowerCase();
        let choiceIndex = null;
        if (key === "a") choiceIndex = 0; // No
        if (key === "l") choiceIndex = 1; // Yes
        if (choiceIndex === null) return;

        event.preventDefault();
        const target = document.querySelector(
          `.binary-gjt .gjt-choice[data-choice="${choiceIndex}"]`
        );
        if (!target || target.disabled) return;

        currentGjtInputMethod = "keyboard";
        currentGjtKey = key.toUpperCase();
        target.click();
      };
      document.addEventListener("keydown", currentGjtKeyHandler);
    },
    response_ends_trial: true,
    css_classes: ["binary-gjt"],
    data: function() {
      if (isPractice) {
        return {
          phase: "gjt_practice",
          practice_id: jsPsych.evaluateTimelineVariable("practice_id"),
          sentence_text: jsPsych.evaluateTimelineVariable("sentence"),
          presented_status: jsPsych.evaluateTimelineVariable("presented_status")
        };
      }
      return {
        phase: "gjt",
        item_id: jsPsych.evaluateTimelineVariable("item_id"),
        presentation_order: jsPsych.evaluateTimelineVariable("display_number"),
        category: jsPsych.evaluateTimelineVariable("category"),
        target_verb: jsPsych.evaluateTimelineVariable("verb"),
        target_pattern: jsPsych.evaluateTimelineVariable("pattern"),
        sentence_text: jsPsych.evaluateTimelineVariable("sentence"),
        presented_status: jsPsych.evaluateTimelineVariable("presented_status"),
        error_type: jsPsych.evaluateTimelineVariable("error_type")
      };
    },
    on_finish: function(data) {
      removeGjtKeyHandler();
      data.judgment = data.response === null ? null : (Number(data.response) === 0 ? "ungrammatical" : "grammatical");
      data.answer_label = data.response === null ? null : (Number(data.response) === 0 ? "No" : "Yes");
      data.input_method = data.response === null ? null : (currentGjtInputMethod || "button");
      data.response_key = data.response === null ? null : currentGjtKey;
      data.timed_out = data.response === null;
      data.correct = data.response === null ? null : data.judgment === data.presented_status;
      if (!isPractice) {
        const gjtDone = jsPsych.data.get().filter({ phase: "gjt" }).count();
        jsPsych.progressBar.progress = Math.min(gjtDone / GJT_ITEM_COUNT, 1);
      }
    }
  };
}

timeline.push({
  timeline: [makeGjtTrial(true)],
  timeline_variables: gjtPracticeItems,
  randomize_order: false
});

timeline.push({
  type: jsPsychHtmlButtonResponse,
  stimulus: `<div class="task-card compact-card"><h2>練習終了</h2>
    <p>ここから英文判断課題${GJT_ITEM_COUNT}問です。</p></div>`,
  choices: ["GJTを始める"],
  data: { phase: "gjt_start" },
  on_start: () => { gjtStartMs = performance.now(); }
});

const orderedGjtItems = (RANDOMIZE_GJT_ITEMS ? jsPsych.randomization.shuffle(GJT_ITEMS) : [...GJT_ITEMS])
  .map((item, index) => ({ ...item, display_number: index + 1 }));

timeline.push({
  timeline: [makeGjtTrial(false)],
  timeline_variables: orderedGjtItems,
  randomize_order: false
});

// ---------- 質問紙への移行 ----------
timeline.push({
  type: jsPsychHtmlButtonResponse,
  stimulus: `<div class="task-card compact-card">
    <h2>英文課題は終了です</h2>
    <p>続いて、英語学習経験と過去7日間の英語接触について回答してください。</p>
    <p>回答時間の目安は3～5分です。</p>
  </div>`,
  choices: ["質問へ進む"],
  data: { phase: "questionnaire_transition" },
  on_start: () => {
    gjtEndMs = performance.now();
    questionnaireStartMs = gjtEndMs;
    jsPsych.data.addProperties({
      gjt_total_rt_ms: Math.round(gjtEndMs - gjtStartMs),
      task_total_rt_ms: Math.round(gjtEndMs - gjtStartMs)
    });
  }
});

// モバイル以外のみ、英文課題終了後に全画面解除。
timeline.push({
  timeline: [{
    type: jsPsychFullscreen,
    fullscreen_mode: false,
    data: { phase: "fullscreen_end" }
  }],
  conditional_function: () => !isLikelyMobile()
});

// ---------- 短縮・改変版LEAP-Q ----------
timeline.push({
  type: jsPsychSurveyHtmlForm,
  preamble: `<div class="task-card compact-card">
    <div class="task-progress">質問1 / 2</div>
    <h2>英語学習経験について</h2>
    <p>現在の状況について回答してください。</p>
  </div>`,
  html: `<div class="questionnaire-form">
    <label for="english_start_age"><strong>1．英語を学び始めた年齢</strong></label>
    <p class="question-help">学校、塾、英会話教室、家庭学習などを含めてください。</p>
    <div class="number-with-unit"><input id="english_start_age" name="english_start_age" type="number" min="0" max="30" step="1" required inputmode="numeric"><span>歳</span></div>

    <label for="formal_english_start_age"><strong>2．英語を継続的・本格的に学び始めた年齢</strong></label>
    <p class="question-help">学校の授業などで、継続して学び始めた年齢を答えてください。</p>
    <div class="number-with-unit"><input id="formal_english_start_age" name="formal_english_start_age" type="number" min="0" max="30" step="1" required inputmode="numeric"><span>歳</span></div>

    <label for="english_learning_years"><strong>3．これまでの英語学習年数</strong></label>
    <div class="number-with-unit"><input id="english_learning_years" name="english_learning_years" type="number" min="0" max="30" step="0.5" required inputmode="decimal"><span>年</span></div>

    <fieldset>
      <legend><strong>4．現在の英語力の自己評価</strong></legend>
      <p class="question-help">1＝ほとんどできない、6＝非常によくできる</p>
      <div class="rating-grid">
        <label for="self_reading">読む</label><select id="self_reading" name="self_reading" required>${["","1","2","3","4","5","6"].map(v => `<option value="${v}">${v || "選択"}</option>`).join("")}</select>
        <label for="self_listening">聞く</label><select id="self_listening" name="self_listening" required>${["","1","2","3","4","5","6"].map(v => `<option value="${v}">${v || "選択"}</option>`).join("")}</select>
        <label for="self_speaking">話す</label><select id="self_speaking" name="self_speaking" required>${["","1","2","3","4","5","6"].map(v => `<option value="${v}">${v || "選択"}</option>`).join("")}</select>
        <label for="self_writing">書く</label><select id="self_writing" name="self_writing" required>${["","1","2","3","4","5","6"].map(v => `<option value="${v}">${v || "選択"}</option>`).join("")}</select>
      </div>
    </fieldset>

    <label for="english_environment_months"><strong>5．英語が日常的に使われる国・地域での滞在経験</strong></label>
    <p class="question-help">経験がない場合は0を入力してください。旅行、留学、居住などを含めた合計期間です。</p>
    <div class="number-with-unit"><input id="english_environment_months" name="english_environment_months" type="number" min="0" max="600" step="0.5" required inputmode="decimal"><span>か月</span></div>
  </div>`,
  button_label: "次へ",
  data: { phase: "leapq_survey", questionnaire_version: "short_adapted_v1" },
  on_finish: data => {
    const r = data.response || {};
    data.english_start_age = Number(r.english_start_age);
    data.formal_english_start_age = Number(r.formal_english_start_age);
    data.english_learning_years = Number(r.english_learning_years);
    data.self_reading = Number(r.self_reading);
    data.self_listening = Number(r.self_listening);
    data.self_speaking = Number(r.self_speaking);
    data.self_writing = Number(r.self_writing);
    data.self_proficiency_mean = (data.self_reading + data.self_listening + data.self_speaking + data.self_writing) / 4;
    data.english_environment_months = Number(r.english_environment_months);
    data.age_consistency_flag = data.formal_english_start_age < data.english_start_age;
    delete data.response;
    leapQEndMs = performance.now();
    data.leapq_elapsed_ms = Math.round(leapQEndMs - questionnaireStartMs);
  }
});

// ---------- 過去7日間のoutside exposure ----------
timeline.push({
  type: jsPsychSurveyHtmlForm,
  preamble: `<div class="task-card compact-card">
    <div class="task-progress">質問2 / 2</div>
    <h2>過去7日間の授業外での英語接触</h2>
    <p>学校の英語授業、学校から出された宿題、授業内の多読活動は含めないでください。</p>
    <p>授業の多読で使用している本を授業外で読んだ時間は、下の専用項目に回答してください。</p>
  </div>`,
  html: `<div class="questionnaire-form exposure-form">
    <fieldset>
      <legend><strong>1．授業の多読で使用している本を、授業外で読む</strong></legend>
      <div class="exposure-row"><label>行った日数<select name="er_outside_days" required>${[0,1,2,3,4,5,6,7].map(v => `<option value="${v}">${v}日</option>`).join("")}</select></label>
      <label>合計時間<input name="er_outside_minutes" type="number" min="0" max="10080" step="1" required inputmode="numeric"><span>分</span></label></div>
    </fieldset>

    <fieldset>
      <legend><strong>2．それ以外の英語の文章を読む</strong></legend>
      <p class="question-help">英語の本、ウェブサイト、SNS、ニュース、漫画、ゲーム内の文章など。</p>
      <div class="exposure-row"><label>行った日数<select name="reading_days" required>${[0,1,2,3,4,5,6,7].map(v => `<option value="${v}">${v}日</option>`).join("")}</select></label>
      <label>合計時間<input name="reading_minutes" type="number" min="0" max="10080" step="1" required inputmode="numeric"><span>分</span></label></div>
    </fieldset>

    <fieldset>
      <legend><strong>3．英語の動画・映画を見る</strong></legend>
      <p class="question-help">映画、ドラマ、YouTubeなど。日本語字幕・英語字幕を使った場合も含みます。</p>
      <div class="exposure-row"><label>行った日数<select name="video_days" required>${[0,1,2,3,4,5,6,7].map(v => `<option value="${v}">${v}日</option>`).join("")}</select></label>
      <label>合計時間<input name="video_minutes" type="number" min="0" max="10080" step="1" required inputmode="numeric"><span>分</span></label></div>
    </fieldset>

    <fieldset>
      <legend><strong>4．英語を聞く</strong></legend>
      <p class="question-help">ポッドキャスト、ラジオ、音声教材など。動画を見ながら聞いた時間は含めません。</p>
      <div class="exposure-row"><label>行った日数<select name="listening_days" required>${[0,1,2,3,4,5,6,7].map(v => `<option value="${v}">${v}日</option>`).join("")}</select></label>
      <label>合計時間<input name="listening_minutes" type="number" min="0" max="10080" step="1" required inputmode="numeric"><span>分</span></label></div>
    </fieldset>

    <fieldset>
      <legend><strong>5．授業外で意図的に英語を学習する</strong></legend>
      <p class="question-help">英語学習アプリ、単語帳、問題集、オンライン英会話など。</p>
      <div class="exposure-row"><label>行った日数<select name="study_days" required>${[0,1,2,3,4,5,6,7].map(v => `<option value="${v}">${v}日</option>`).join("")}</select></label>
      <label>合計時間<input name="study_minutes" type="number" min="0" max="10080" step="1" required inputmode="numeric"><span>分</span></label></div>
    </fieldset>
  </div>`,
  button_label: "次へ",
  data: {
    phase: "outside_exposure_survey",
    recall_period_days: 7,
    exposure_version: "weekly_v1",
    week_number: 0,
    survey_date_local: new Date().toLocaleDateString("sv-SE")
  },
  on_load: () => {
    document.querySelectorAll(".exposure-row").forEach(row => {
      const select = row.querySelector("select");
      const input = row.querySelector('input[type="number"]');
      const sync = () => {
        if (select.value === "0") {
          input.value = "0";
        } else if (input.value === "0") {
          input.value = "";
        }
      };
      select.addEventListener("change", sync);
      sync();
    });
  },
  on_finish: data => {
    const r = data.response || {};
    const names = ["er_outside", "reading", "video", "listening", "study"];
    let totalMinutes = 0;
    let incidentalMinutes = 0;
    let inconsistencyCount = 0;
    names.forEach(name => {
      const days = Number(r[`${name}_days`]);
      const minutes = Number(r[`${name}_minutes`]);
      data[`${name}_days`] = days;
      data[`${name}_minutes`] = minutes;
      totalMinutes += minutes;
      if (["reading", "video", "listening"].includes(name)) incidentalMinutes += minutes;
      if ((days === 0 && minutes > 0) || (days > 0 && minutes === 0)) inconsistencyCount += 1;
    });
    data.exposure_total_minutes = totalMinutes;
    data.incidental_exposure_minutes = incidentalMinutes;
    data.intentional_study_minutes = data.study_minutes;
    data.er_outside_minutes_separate = data.er_outside_minutes;
    data.exposure_inconsistency_count = inconsistencyCount;
    delete data.response;
    exposureEndMs = performance.now();
    data.exposure_elapsed_ms = Math.round(exposureEndMs - leapQEndMs);
    data.questionnaire_total_rt_ms = Math.round(exposureEndMs - questionnaireStartMs);
  }
});

// 操作性アンケート。
timeline.push({
  type: jsPsychSurveyHtmlForm,
  preamble: `<div class="task-card compact-card"><h2>最後の質問</h2>
    <p>操作について教えてください。</p></div>`,
  html: `<div class="usability-form">
    <label>画面の見やすさ</label>
    <select name="screen_readability" required>
      <option value="">選択</option><option value="1">1 とても見にくい</option>
      <option value="2">2</option><option value="3">3</option><option value="4">4</option>
      <option value="5">5 とても見やすい</option>
    </select>
    <label>ボタンの押しやすさ</label>
    <select name="button_usability" required>
      <option value="">選択</option><option value="1">1 とても押しにくい</option>
      <option value="2">2</option><option value="3">3</option><option value="4">4</option>
      <option value="5">5 とても押しやすい</option>
    </select>
    <label>自由記述（任意）</label>
    <textarea name="comments" rows="3" maxlength="500"></textarea>
  </div>`,
  button_label: "送信",
  data: { phase: "usability_survey" },
  on_start: () => {
    jsPsych.data.addProperties({
      questionnaire_completed: true
    });
  }
});

// 最終保存。
timeline.push({
  type: jsPsychHtmlButtonResponse,
  stimulus: `<div class="task-card save-message" id="final-save-panel">
    <div class="spinner"></div><h2>回答を保存しています</h2>
    <p>保存完了の表示が出るまで画面を閉じないでください。</p>
  </div>`,
  choices: [],
  data: { phase: "final_save" },
  on_load: async function() {
    const values = jsPsych.data.get().values();
    const participantId = values.find(row => row.participant_id)?.participant_id || "unknown";
    const safePid = participantId.replace(/[^A-Za-z0-9_-]/g, "_");
    const filename = `${STUDY_NAME}_${safePid}_${sessionId}_final.csv`;
    const gjtRows = jsPsych.data.get().filter({ phase: "gjt" });

    jsPsych.data.addProperties({
      session_end_iso: new Date().toISOString(),
      session_total_rt_ms: Math.round(performance.now() - sessionStartMs),
      completed_gjt_items: gjtRows.count(),
      completed_leapq: jsPsych.data.get().filter({ phase: "leapq_survey" }).count(),
      completed_outside_exposure: jsPsych.data.get().filter({ phase: "outside_exposure_survey" }).count(),
      gjt_timeout_count: gjtRows.filter({ timed_out: true }).count(),
      interaction_data_json: JSON.stringify(jsPsych.data.getInteractionData().values())
    });

    const panel = document.getElementById("final-save-panel");
    const csvText = jsPsych.data.get().csv();
    try {
      if (!DATAPIPE_EXPERIMENT_ID.trim()) throw new Error("DataPipe Experiment ID is empty.");
      await saveToDataPipe(csvText, filename);
      panel.innerHTML = `<h2 class="status-success">保存が完了しました</h2>
        <div class="summary-box">
          <div><strong>参加者番号：</strong>${participantId}</div>
          <div><strong>GJT：</strong>${gjtRows.count()} / ${GJT_ITEM_COUNT}</div>
          <div><strong>LEAP-Q：</strong>${jsPsych.data.get().filter({ phase: "leapq_survey" }).count()} / 1</div>
          <div><strong>Outside exposure：</strong>${jsPsych.data.get().filter({ phase: "outside_exposure_survey" }).count()} / 1</div>
          <div><strong>GJT時間切れ：</strong>${gjtRows.filter({ timed_out: true }).count()}</div>
        </div>
        <p>ご協力ありがとうございました。</p>`;
    } catch (error) {
      console.error("Final save failed", error);
      if (ENABLE_LOCAL_CSV_FALLBACK) jsPsych.data.get().localSave("csv", filename);
      panel.innerHTML = `<h2 class="status-error">オンライン保存に失敗しました</h2>
        <p>${ENABLE_LOCAL_CSV_FALLBACK ? "CSVを端末に保存しました。" : "担当者に連絡してください。"}</p>
        <p><strong>この画面を閉じず、担当者に連絡してください。</strong></p>`;
    }
  }
});

jsPsych.run(timeline);
