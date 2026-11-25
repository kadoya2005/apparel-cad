# アパレルCAD マニュアル

ブラウザで見るマニュアルです。`index.html` から開きます。

| ページ | 中身 |
|---|---|
| [concept.html](concept.html) | 概要（A4 1 枚で印刷できる） |
| [guide.html](guide.html) | 使い方ガイド（キャプチャと図で、手順ごと） |
| [index.html](index.html) | 画面の場所（番号を押すと、画面のその場所が赤い枠で光る） |

## キャプチャを撮り直す

アプリの画面が変わったら、キャプチャを撮り直します（Edge を画面なしで動かして撮ります）。

```
cd apparel-cad
python -m http.server 8745 --bind 127.0.0.1
```

別のウィンドウで：

```
python manual/tools/capture.py
python manual/tools/dxf_preview.py "samples/フレアスカートの見本_v1.dxf" manual/img/dxf-flare.svg
```

`manual/img/` の画像と、枠の位置（`manual/shots.js`）が新しくなります。説明の文は `data.js`（画面の場所）と `guide.html` にあります。
