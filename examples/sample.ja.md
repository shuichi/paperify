---
title: "軽量なMarkdownからHTMLへの論文コンバーター"
subtitle: "Webと印刷のためのCSSファーストな学術出版"
authors:
  - name: "アリス・エグザンプル"
    affiliation: "エグザンプル大学"
    email: "alice@example.edu"
  - name: "ボブ・エグザンプル"
    affiliation: "エグザンプル研究所"
date: "2026-07-04"
abstract: |
  本稿では、高品質なオンライン閲覧と二段組みの印刷出力のために
  設計された軽量なMarkdownからHTMLへのコンバーターであるPaperifyに
  ついて述べる。このコンバーターは最小限で意味的なHTMLを出力し、
  入念に書かれたスタイルシートが画面表示と印刷の両方のレイアウトと
  タイポグラフィを担う。数式、図、表、コード、脚注、動画をすべて
  プレーンなMarkdownで表現しながら、印刷可能な形に保てることを示す。
keywords:
  - Markdown
  - HTML
  - CSS
  - 学術出版
lang: ja
headerTemplate: |
  <div style="font-family:'Noto Sans JP', sans-serif;font-size:8px;width:100%;text-align:center"></div>
footerTemplate: |
  <div style="font-family:'Noto Sans JP', sans-serif;font-size:8px;width:100%;text-align:center">
    <span class="pageNumber"></span>/<span class="totalPages"></span>
  </div>
---

## はじめに

学術執筆ツールは、優れた印刷出力を持つ重量級のLaTeXツールチェーンと、
印刷への道筋をほとんど持たないWebファーストなMarkdownレンダラーという
二つの極に集まりがちである。Paperifyは意図的にその中間に位置し、
Pandocの文書変換モデルからいくらか着想を得ている
[@macfarlane2006pandoc][^1]。執筆形式はプレーンなMarkdownであり、
出力は単一のポータブルなHTMLファイルである。そして_同じ_文書が、
スマートフォンでは読みやすく、印刷時には二段組みの論文として出力される。

設計思想は単純である。HTMLを意味的で安定したものに保ち、
見た目の仕事はスタイルシートに任せる。コンバーターがレイアウト判断に
踏み込みすぎなければ、テーマを変える余地が残り、文書も長く保てる。

## 方法

トークン列 $x_1, x_2, \ldots, x_n$ が与えられたとき、同時確率を
自己回帰的にモデル化する。

$$
p(x_1, \ldots, x_n) = \prod_{i=1}^{n} p(x_i \mid x_1, \ldots, x_{i-1})
$$

トークンごとの損失は負の対数尤度
$\mathcal{L} = -\frac{1}{n}\sum_i \log p(x_i \mid x_{<i})$ である。
ここではインラインで表示し、数式が本文の流れの中に自然に収まることを示している。

### アーキテクチャ概要

通常のMarkdown画像だけを含む段落は、altテキストをキャプションとしても使う
意味的な図に変換される。

![コンバーターの段組みを考慮したレンダリングパイプライン](media/figure1.svg)

横幅の広い図はディレクティブで指定し、印刷時には両方の段にまたがる。

::figure{src="media/system.svg" alt="システム図" caption="図2: システム概要。印刷時にはこの図がページ幅いっぱいにまたがる。" wide=true}

### デモ動画

動画はディレクティブで埋め込まれる。画面上では動画を再生でき、
印刷時にはポスターフレームと読み取りやすいソースリンクが表示される。

::video{src="media/demo.mp4" poster="media/demo-poster.svg" caption="監視モードでのライブ再ビルドを示す短いデモ。" controls=true}

## 評価

Paperifyを二つのベースラインと比較し、文書のビルド時間と出力サイズを測定した。
値は十回の実行の中央値である。

| システム       | ビルド時間 (ms) | 出力サイズ (KB) | 印刷レイアウト |
| -------------- | --------------: | ---------------: | :------------- |
| Paperify       |              84 |               46 | 二段組み       |
| ベースラインA  |             410 |              212 | 一段組み       |
| ベースラインB  |           2,930 |              188 | 二段組み       |

変換パイプライン自体は短く、unifiedの構造化されたコンテンツモデルの上に
構築されている [@unified2015unified]。中核は次のような形である。

```ts
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkDirective)
  .use(paperifyTransforms)
  .use(remarkRehype)
  .use(rehypeKatex)
  .use(rehypeHighlight, { detect: false })
  .use(rehypeStringify);
```

> 設計メモ: 本稿で扱うすべての機能、すなわち数式、図、表、脚注、
> 動画は、段階的に無理なく劣化する。ディレクティブが取り除かれても、
> それ以外の部分では文書は妥当なMarkdownであり続ける。

## 考察

ブラウザーにおける二段組み印刷レイアウトは完全ではない。段の均等化や
改ページ制御はエンジンによって異なる[^2]。Paperifyは、インストール不要の
ツールチェーンと引き換えに、このトレードオフを受け入れる。Paperifyは
TeXそのものになろうとはせず、TeX時代の出版が持っていたタイポグラフィ上の
規律をいくらか借りている [@knuth1984texbook]。高度なフロート配置や、
真のページ下部脚注は、v1では明示的に対象外である。

## 結論

Paperifyは、Markdownパイプラインと規律ある一つのスタイルシートがあれば、
読みやすく印刷しやすい学術文書を作れることを示している。コンバーターは
小さく保ち、CSSが仕上げの技を担う。

[^1]:
    この名前は、名詞を動詞化する慣習にならったものである。
    私たちはそれを推奨もしなければ、謝罪もしない。

[^2]:
    執筆時点では、Chromiumが一般に最も予測しやすい多段組みの
    印刷出力を生成する。
