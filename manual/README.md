# アパレルCAD マニュアル

ブラウザで見るマニュアルです。`index.html` から開きます。

| ページ | 中身 |
|---|---|
| [concept.html](concept.html)・[concept.pdf](concept.pdf) | 概要（A4 1 枚） |
| [quickstart.html](quickstart.html)・[quickstart.pdf](quickstart.pdf) | クイックスタート（A4 2 枚） |
| [tutorial.html](tutorial.html)・[tutorial.pdf](tutorial.pdf) | 見本ができるまで（白紙からフレアスカートまで 12 手順） |
| [guide.html](guide.html)・[guide.pdf](guide.pdf) | 使い方ガイド（キャプチャと図で、手順ごと。PDF は 11 ページ） |
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
python manual/tools/capture_tutorial.py
python manual/tools/dxf_preview.py "samples/フレアスカートの見本_v1.dxf" manual/img/dxf-flare.svg
```

`manual/img/` の画像と、枠の位置（`manual/shots.js`）が新しくなります。

PDF を作り直すとき（サーバーを動かしたまま）：

```
python manual/tools/make_pdf.py
```説明の文は `data.js`（画面の場所）と `guide.html` にあります。
