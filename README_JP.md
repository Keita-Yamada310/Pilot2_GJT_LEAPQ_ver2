# Pilot 2：GJT + LEAP-Q + Outside exposure版

この版ではオンラインFPTを削除しています。FPTは紙で別途実施してください。

## 実施順

1. 参加者番号入力
2. GJT説明
3. GJT練習2問
4. GJT本課題32問
5. LEAP-Q短縮・改変版
6. 過去7日間のOutside exposure
7. 操作性アンケート
8. DataPipeへ最終CSV保存

## GJT仕様

- 32項目、提示順ランダム
- 10秒制限
- 左：No（赤・黒文字）
- 右：Yes（緑 #008000・黒文字）
- PC：Aキー = No、Lキー = Yes
- スマホ・タブレット：ボタンをタップ可能
- スマホでは英文を原則1行に収めるよう文字サイズを自動調整（最小13px）
- 長文の表示前にサイズを確定し、問題切り替え時の表示ぶれを抑制

## 保存される主な情報

- GJT各項目：item_id, presentation_order, verb, pattern, sentence, judgment, correct, RT, timeout, input_method, response_key 等
- GJT全体所要時間：gjt_total_rt_ms
- LEAP-Q回答と所要時間：leapq_elapsed_ms
- Outside exposure回答と所要時間：exposure_elapsed_ms
- 質問紙合計時間：questionnaire_total_rt_ms
- セッション全体時間：session_total_rt_ms

## 設定

`config.js` の `DATAPIPE_EXPERIMENT_ID` に使用するDataPipe Experiment IDを入力してください。


## FPT削除版（GJT＋質問紙）追加仕様

- 冒頭で参加者番号と使用デバイスを選択します。
- GJT終了直後に `*_gjt.csv` をDataPipeへ保存します。
- LEAP-QとOutside exposure終了直後に `*_questionnaire.csv` をDataPipeへ保存します。
- 最後に操作性アンケートを含む全データを `*_full_final.csv` として保存します（バックアップ兼統合データ）。
- オンライン保存に失敗した場合、`ENABLE_LOCAL_CSV_FALLBACK = true` なら該当CSVを端末へ保存します。
