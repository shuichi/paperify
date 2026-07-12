---
paperify: true
title: "MarkdownをHTMLへ変換する軽量な論文コンバーター"
subtitle: "Web閲覧と印刷に向けたCSSファーストの学術出版"
authors:
  - name: "アリス・エグザンプル"
    affiliation: "エグザンプル大学"
    email: "alice@example.edu"
  - name: "ボブ・エグザンプル"
    affiliation: "エグザンプル研究所"
date: "2026-07-04"
abstract: |
  本稿では、オンラインで読みやすく、二段組みの印刷出力にも適した
  軽量なMarkdown-to-HTMLコンバーターであるPaperifyについて述べる。
  Paperifyは、必要最小限のセマンティックなHTMLを生成し、画面表示と
  印刷のレイアウトおよびタイポグラフィは、丁寧に設計された
  スタイルシートに委ねる。数式、図、表、コード、脚注、動画といった
  要素をプレーンなMarkdownで表現しながら、印刷に耐える文書として
  仕上げられることを示す。
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

リアリタイムに編集できる。

学術文書を書くためのツールは、印刷品質に優れる一方で環境が重くなりがちな
LaTeX系ツールチェーンと、Web表示には強いものの印刷まで考慮されることが
少ないMarkdownレンダラーという、二つの極に分かれがちである。Paperifyは
意図的にその中間を目指し、Pandocの文書変換モデルも一部参考にしている
[@macfarlane2006pandoc][^1]。執筆はプレーンなMarkdownで行い、出力は
単一のポータブルなHTMLファイルにまとめる。そして*同じ*文書を、
スマートフォンでは読みやすく表示し、印刷時には二段組みの論文として整える。

方針は単純である。HTMLはセマンティックで安定した構造に保ち、見た目の調整は
スタイルシートに任せる。コンバーターがレイアウト上の判断に踏み込みすぎなければ、
テーマを差し替えやすく、文書も長く使える。

## 方法

トークン列 $x_1, x_2, \ldots, x_n$ が与えられたとき、その同時確率を
自己回帰的に表す。

$$
p(x_1, \ldots, x_n) = \prod_{i=1}^{n} p(x_i \mid x_1, \ldots, x_{i-1})
$$

トークンごとの損失は負の対数尤度
$\mathcal{L} = -\frac{1}{n}\sum_i \log p(x_i \mid x_{<i})$ である。
ここでは本文中のインライン数式として表示し、数式が文章の流れに自然に
収まることを示している。

### アーキテクチャ概要

画像だけで構成される通常のMarkdown段落は、altテキストをキャプションにも用いる
セマンティックな図に変換される。

![コンバーターの段組みを考慮したレンダリングパイプライン](media/figure1.svg)

横幅の広い図はディレクティブで指定でき、印刷時には二段をまたいで表示される。

::figure{src="media/system.svg" alt="システム図" caption="図2: システム概要。印刷時にはこの図がページ幅いっぱいにまたがる。" wide=true}

### デモ動画

動画はディレクティブで埋め込む。画面では再生可能な動画として表示し、
印刷時にはポスターフレームと読みやすいソースリンクを表示する。

::video{src="media/demo.mp4" poster="media/demo-poster.svg" caption="監視モードでのライブ再ビルドを示す短いデモ。" controls=true}

## 評価

Paperifyを二つのベースラインと比較し、文書のビルド時間と出力サイズを測定した。
値は10回の実行における中央値である。

| システム      | ビルド時間 (ms) | 出力サイズ (KB) | 印刷レイアウト |
| ------------- | --------------: | --------------: | :------------- |
| Paperify      |              84 |              46 | 二段組み       |
| ベースラインA |             410 |             212 | 一段組み       |
| ベースラインB |           2,930 |             188 | 二段組み       |

変換パイプライン自体は短く、unifiedの構造化されたコンテンツモデルの上に
構築されている [@unified2015unified]。中核はおおむね次のような形である。

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

> 設計メモ: 本稿で扱う数式、図、表、脚注、動画はいずれも、
> 環境に応じて無理なく段階的に劣化する。ディレクティブを取り除いても、
> それ以外の部分は妥当なMarkdownとして読み続けられる。

## 考察

ブラウザーで二段組みを印刷する仕組みは、まだ完全ではない。段の高さの揃え方や
改ページ制御は、利用するエンジンによって差が出る[^2]。Paperifyは、
インストール不要のツールチェーンを得る代わりに、この制約を受け入れる。
TeXそのものを再現しようとはせず、TeX時代の出版が備えていたタイポグラフィ上の
規律を必要な範囲で借りる [@knuth1984texbook]。高度なフロート配置や、
ページ下部に固定される本格的な脚注は、v1では明示的に対象外とする。

## 結論

Paperifyは、Markdownパイプラインと規律ある一つのスタイルシートがあれば、
読みやすく印刷しやすい学術文書を作れることを示している。コンバーターは
小さく保ち、仕上げはCSSに任せる。

[^1]:
    この名前は、名詞を動詞化する英語圏の慣習にならったものである。
    この言い方を積極的に推奨するわけでも、弁明するつもりでもない。

[^2]:
    執筆時点では、Chromiumが多段組みの印刷出力をもっとも予測しやすく
    生成する傾向がある。

```bibtex
@misc{macfarlane2006pandoc,
  author = {MacFarlane, John},
  title = {Pandoc: A Universal Document Converter},
  year = {2006},
  url = {https://pandoc.org}
}

@misc{unified2015unified,
  author = {{The unified collective}},
  title = {unified: Content as Structured Data},
  year = {2015},
  url = {https://unifiedjs.com}
}

@book{knuth1984texbook,
  author = {Knuth, Donald E.},
  title = {The TeXbook},
  publisher = {Addison-Wesley},
  year = {1984}
}
```
