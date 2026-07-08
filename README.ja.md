# Paperify

<p align="center">
  <img src="./icon.svg" alt="Paperify icon" width="120" height="120">
</p>

[English](./README.md) | 日本語

**CSS ファーストの学術出版ツール: Markdown から、画面で読みやすく、2 段組み論文として印刷できるポータブルな HTML を生成します。**

Paperify は、学術文書向けの軽量な Markdown-to-HTML コンバーターです。LaTeX のクローンを目指しているわけではありません。コンバーターは小さく保ち、最小限でセマンティックな HTML を出力します。画面表示と印刷のレイアウトやタイポグラフィは、丁寧に書かれたスタイルシート (`paperify.css`) が担います。

- **画面**: デスクトップでもモバイルでも読みやすい、中央寄せの単一カラム。
- **印刷 / PDF**: ブラウザー自身の印刷エンジンで作る A4 の 2 段組み学術論文。タイトル、著者、概要、キーワードは単一カラムのまま、本文だけが 2 段組みになり、改ページや段分割も調整されます。

同じコンパイル済み HTML ファイルが画面表示と印刷の両方に使われます。実行時 JavaScript もサーバーも不要です。直接 `.pdf` を出力する場合は、ビルド時に Puppeteer/Chromium を使います。

## インストール

Paperify には Node.js 24 LTS 以降が必要です。このリポジトリには、現在の最新 LTS である Node.js 24.18.0 に固定した `.nvmrc` が含まれています。

```bash
npm install          # 依存関係をインストール
npm run build        # TypeScript を dist/ にコンパイル
npm test             # テストスイートを実行
npm run example      # examples/sample.md を dist/sample.html にコンパイル
```

CLI をどこからでも使えるようにするには:

```bash
npm install -g .     # または: npm link
paperify input.md -o output.html
paperify input.md -o output.pdf
```

## CLI の使い方

```text
paperify <input.md> [options]

--output, -o <file>   このパスにコンパイルする。.pdf の場合は隣に .html も書き出す
                      (default: <input>.html)
--css <file>          カスタム CSS ファイルのパス (default: bundled paperify.css)
--bib, --bibliography <file>
                      BibTeX 参考文献ファイル
                      (default: frontmatter bibliography,
                      terminal bibtex block, or <input>.bib)
--csl <id>            Zotero Style Repository の CSL スタイル ID
                      (default: computing-surveys)
--embed-css           互換性のためのオプション。コンパイル済み HTML は常に CSS を埋め込む
--unsafe-html         Markdown 内のサニタイズ済み raw HTML を許可する
--title <title>       frontmatter の title を上書きする
--lang <lang>         HTML の lang 属性を上書きする
                      (default: frontmatter lang, then en)
--browser-executable <file>
                      PDF 出力に使う Chrome/Chromium 実行ファイル
--watch               ファイル変更時に再ビルドする
--copy-assets         互換性のためのオプション。画像や poster はコンパイル時にインライン化される
--help                ヘルプを表示する
```

Paperify は Markdown を自己完結した HTML ファイルにコンパイルします。コンパイル済み HTML には Paperify CSS、ローカル画像、動画 poster/fallback、KaTeX CSS、KaTeX フォントが data URI として埋め込まれるため、HTML 単体で開けます。動画ファイル本体は埋め込まれません。ローカル動画ソースを再生用に出力先の隣へコピーしたい場合は `--copy-assets` を使ってください。

出力パスが `.pdf` で終わる場合、Paperify はまず PDF の隣にコンパイル済み HTML を書き出し、その HTML を Puppeteer の Chromium エンジンで開いて PDF に印刷します。たとえば `paperify paper.md -o dist/paper.pdf` は `dist/paper.html` と `dist/paper.pdf` の両方を書き出します。

## サンプル文書

このリポジトリには、同じ機能を試せる英語と日本語のサンプル論文が含まれています。frontmatter、数式、引用、図、表、コード、脚注、動画を確認できます。

- `examples/sample.md` は `npm run example` で使われる英語サンプルです。
- `examples/sample.ja.md` は日本語サンプルです。frontmatter で `lang: ja` を設定しているため、生成 HTML は `<html lang="ja">` になり、同梱 CSS が `:root:lang(ja)` によって日本語向けフォント変数へ切り替わります。
- `examples/sample.bib` は両方のサンプルで共有する BibTeX エントリーです。

デフォルトの英語サンプルをビルドするには:

```bash
npm run example
```

日本語サンプルをビルドするには:

```bash
npm run build
node dist/cli.js examples/sample.ja.md --bib examples/sample.bib -o dist/sample.ja.html
```

日本語サンプルを PDF としてビルドするには:

```bash
npm run build
node dist/cli.js examples/sample.ja.md --bib examples/sample.bib -o dist/sample.ja.pdf
```

## Markdown の書き方

Paperify は unified エコシステムを使っています。`remark-parse` と `remark-gfm` により、標準 Markdown に加えて GitHub Flavored Markdown の拡張 (表、脚注、取り消し線、自動リンク) がそのまま使えます。見出しには安定した slug ID (`## Related Work` → `id="related-work"`) が付くため、内部リンクは再ビルド後も維持されます。

### YAML frontmatter

```yaml
---
title: "A Lightweight Markdown-to-HTML Paper Converter"
subtitle: "CSS-first academic publishing for web and print"
authors:
  - name: "Alice Example"
    affiliation: "Example University"
    email: "alice@example.edu"
  - name: "Bob Example"
    affiliation: "Example Lab"
date: "2026-07-04"
abstract: |
  One or more paragraphs of abstract text.
keywords:
  - Markdown
  - academic publishing
lang: en
footerTemplate: |
  <div style="font-size:8px;width:100%;text-align:center">
    <span class="pageNumber"></span>/<span class="totalPages"></span>
  </div>
---
```

すべてのフィールドは省略可能です。著者は単なる文字列でも指定でき、キーワードはカンマ区切りの文字列でも指定できます。通常の文書メタデータは正規化され、HTML エスケープされてからレンダリングされます。`headerTemplate` と `footerTemplate` は直接 PDF 出力するときだけ使われ、Puppeteer のヘッダー/フッター HTML テンプレートとして渡されます。

`lang` は生成される `<html lang="...">` 属性を設定します。同梱スタイルシートはこの属性を使って言語に応じたタイポグラフィを適用します。日本語論文では `lang: ja` (または `language: ja-JP`) を設定すると、本文と見出しのフォント変数が自動で切り替わります。

### 数式

- インライン数式: `$E = mc^2$`
- ディスプレイ数式: `$$ ... $$`

数式は KaTeX によって**ビルド時に静的 HTML としてレンダリング**されます。出力 HTML は、数式を表示するための JavaScript を必要としません。コンパイル済み HTML には、インストール済み `katex` パッケージから取得した KaTeX スタイルシートとフォントが埋め込まれます。

印刷時のディスプレイ数式は、過度に大きくならないよう調整され、段内に収められます。エンジンが対応している場合は、段をまたいだ分割も避けます。画面では、非常に長い数式ははみ出すのではなく横スクロールになります。

### 引用と参考文献

BibTeX に基づく引用には Pandoc 風の citation key を使います。

```markdown
Paperify builds on structured Markdown processing [@unified2015unified].
Multiple sources can appear in one cluster [@foo; @bar].
```

Paperify は次の順序で参考文献データを解決します。

1. `--bib` / `--bibliography` が明示されている場合。このパスは現在の作業ディレクトリから解決します。
2. frontmatter の `bibliography`。このパスは Markdown ファイルからの相対パスとして解決します。
3. Markdown 末尾の `bibtex` fenced code block。このブロックは HTML には表示されず、BibTeX ソースとして使われます。空または空白だけの末尾 `bibtex` ブロックは、HTML からは隠しますがソースとしては無視します。
4. 入力 Markdown の隣にある同じベース名の BibTeX ファイル。`paper.md` なら、存在する場合は `paper.bib` を使います。

参考文献ファイルを明示することもできます。

```bash
paperify paper.md --bib references.bib -o paper.html
```

frontmatter に参考文献パスを置くこともできます。

```yaml
---
bibliography: references/paper.bib
---
```

コンパクトで持ち運びやすい下書きでは、Markdown ファイルの末尾に BibTeX を置けます。

````markdown
Paperify builds on structured Markdown processing [@unified2015unified].

```bibtex
@misc{unified2015unified,
  author = {{The unified collective}},
  title = {unified: Content as Structured Data},
  year = {2015},
  url = {https://unifiedjs.com}
}
```
````

`[@key]` のような引用があるのに参考文献ソースを解決できない場合、CLI は分かりやすいエラーで終了します。

引用の整形は Citation.js と citeproc-js によってビルド時に行われます。CSL スタイルは Zotero Style Repository から ID でダウンロードされます。デフォルトのスタイルは `computing-surveys` です。別の Zotero スタイル ID は `--csl` で指定できます。

```bash
paperify paper.md --csl association-for-computing-machinery -o paper.html
```

生成される引用と参考文献は静的 HTML なので、コンパイル済み文書は実行時 JavaScript を必要としません。引用マーカーは、生成された参考文献リスト内の対応する項目へリンクします。

### 画像と図

画像だけを含む段落はセマンティックな figure になり、alt テキストがキャプションとしても使われます。

```markdown
![Caption text](images/figure1.png)
```

```html
<figure class="image-figure">
  <img src="images/figure1.png" alt="Caption text" />
  <figcaption>Caption text</figcaption>
</figure>
```

alt テキストのない画像も figure になりますが、空のキャプションは出力されません。通常の文章の中にある画像は、そのままインライン画像として扱われます。

印刷時に 2 段をまたいで表示する**ワイド図**など、明示的に制御したい場合は figure directive を使います。

```markdown
::figure{src="images/system.png" alt="System diagram" caption="System overview" wide=true}
```

### 動画

```markdown
::video{src="media/demo.mp4" poster="media/demo-poster.png" caption="Demo video" controls=true}
```

対応属性は `src` (必須)、`poster`、`caption`、`controls` (デフォルトで有効)、`loop`、`muted`、`autoplay`、`wide` です。MIME type はファイル拡張子 (`.mp4`、`.webm`、`.ogg`/`.ogv`、`.mov`) から推定されます。

- **画面では**ネイティブ controls 付きで動画を再生できます。
- **印刷では** `<video>` 要素と controls は隠されます。poster 画像があればそれを印刷し、なければ動画ファイル名を示す簡潔な placeholder box を表示します。どちらの場合も、紙面から動画に到達できるように "Video available at: ..." というソース行が印刷されます。

### 表、コード、脚注、引用ブロック

- **表**は GFM 記法で書け、booktabs 風の細い罫線で表示されます。画面では幅の広い表が横スクロールになり、印刷では段内に収められ、可能な範囲で分割を避けます。
- **コードブロック**は fence で書き、`ts` fence のような言語タグに基づいてビルド時にハイライトされます。ラベルのないブロックはプレーンテキストのままです。印刷ではコードが切り落とされずに折り返されます。
- **脚注**は GFM 記法 (`[^1]`) を使い、文書末尾にコンパクトにレンダリングされます。ページ下部の本格的な脚注は v1 の範囲外です。
- **引用ブロック**は細い左罫線を持つ、控えめな学術メモとして表示されます。

### Raw HTML

Raw HTML は**デフォルトで無効**です。ソース内の未知の HTML は削除されます。`--unsafe-html` を指定すると raw HTML が許可されますが、安全な学術要素 (テキスト意味付け、見出し、リスト、表、figure、画像、`video`/`source`、KaTeX 互換の code class) の allowlist に基づいてサニタイズされます。script、event handler、`javascript:` URL は常に取り除かれます。

## 画面表示と印刷の違い

| 項目 | 画面 | 印刷 |
| --- | --- | --- |
| レイアウト | 中央寄せの単一カラム (~78ch) | A4 2 段組み、front matter は単一カラム |
| 本文サイズ | 16px、line-height 1.7 | 9.5pt、line-height 1.45 |
| ワイド要素 | 通常幅 | `column-span: all` |
| 動画 | 再生可能 | poster / placeholder + source URL |
| 長い数式 | 横スクロール | 段内に制約 |
| リンク | アクセント色の下線 | プレーンテキスト (URL 表示はオプション) |

リンクテキストの後に外部 URL を印刷したい場合は、後処理やカスタムテンプレートで `<body>` に `class="print-show-urls"` を追加してください。出力を静かに保つため、この機能はデフォルトで無効です。

## PDF へのエクスポート

推奨される方法は直接 PDF 出力です。

```bash
paperify paper.md -o paper.pdf
```

Paperify は Puppeteer を使ってコンパイル済み HTML ファイルを開き、Chromium の `print` media type、`preferCSSPageSize`、背景グラフィック有効化を使って PDF に印刷します。スタイルシートの `@page` ルールが A4 ページサイズと余白を制御します。

PDF のヘッダーとフッターは YAML frontmatter から制御できます。

```yaml
---
title: "Paper Title"
headerTemplate: |
  <div style="font-size:8px;width:100%;padding:0 12mm">
    <span class="title"></span>
  </div>
footerTemplate: |
  <div style="font-size:8px;width:100%;text-align:center">
    <span class="pageNumber"></span>/<span class="totalPages"></span>
  </div>
---
```

Puppeteer は `date`、`title`、`url`、`pageNumber`、`totalPages` という class 名を持つ特別な span を埋めます。ヘッダー/フッターテンプレートは Puppeteer の印刷余白領域でレンダリングされるため、必要なスタイルはインラインまたはテンプレート内の `<style>` タグに入れてください。

Puppeteer が管理下のブラウザーを見つけられない、または起動できない場合は、`npx puppeteer browsers install chrome` でインストールするか、既存の Chrome/Chromium バイナリを Paperify に指定してください。

```bash
paperify paper.md -o paper.pdf --browser-executable "/path/to/chrome"
```

HTML 出力をブラウザーで開き、**Print → Save as PDF** を選ぶこともできます。ただし、ブラウザーごとに印刷エンジンの挙動は異なります。手動エクスポートでは Chromium 系ブラウザーが最も予測しやすい選択肢です。

## paperify.css のカスタマイズ

視覚表現を担当する成果物はスタイルシートです。HTML は意図的に素直な構造にしています。テーマ化できる値は CSS custom property として公開されています。

```css
:root {
  --font-body: Georgia, "Times New Roman", serif;
  --paper-width: 72ch;
  --accent-color: #8b0000;
}
```

テーマ変更の方法:

- **自分のスタイルシートを渡す**: `--css mytheme.css` を使います。`styles/paperify.css` のコピーから始めるのがおすすめです。カスタム CSS は同梱スタイルシートを置き換えます。
- **変数を上書きする**: コピーしたスタイルシートを編集するか、カスタムスタイルシートに override を追加します。
- **言語別デフォルトを使う**: frontmatter に `lang: ja` を設定するか `--lang ja` を渡します。`paperify.css` は `:root:lang(ja)` で日本語の本文フォントと見出しフォントを適用します。
- 印刷向けの調整値 (`--print-body-size`、`--print-line-height`、`--print-column-gap`) も同じ `:root` ブロックにあります。

ファイルは番号付きコメントのセクション (tokens → base → reading column → front matter → content → print) に分かれているため、必要な箇所だけ安全に編集できます。

## 制限事項

- **完全な LaTeX 代替ではありません。** 番号付き数式/定理、相互参照の解決、自動図番号には対応していません。
- **引用サポートは意図的に小さく保っています。** `[@key]` のような BibTeX key と CSL 参考文献には対応していますが、citation locator、引用の prefix/suffix、相互参照の解決には対応していません。
- **ブラウザーの印刷エンジンには差があります。** 段組みのバランシング、`break-inside`、`column-span` の対応は Chromium、Firefox、Safari で異なります。直接 `.pdf` 出力は、より安定したエクスポート経路として Puppeteer/Chromium を使います。
- **高度な float 配置と本格的なページ下部脚注は範囲外です。** 図は現れた位置で印刷され、脚注は文書末尾に集められます。

## プロジェクト構成

```text
src/
  cli.ts                     CLI: args, watch, compile/PDF orchestration
  compile.ts                 self-contained compiled HTML generation
  convert.ts                 unified pipeline (remark → rehype)
  pdf.ts                     Puppeteer PDF rendering
  template.ts                standalone HTML document assembly
  frontmatter.ts             YAML metadata parsing & normalization
  assets.ts                  local asset collection & copying
  transforms/
    figures.ts               image-only paragraph → <figure>
    figureDirective.ts       ::figure{...}
    videoDirective.ts        ::video{...} + print fallback markup
    sanitizeSchema.ts        allowlist for --unsafe-html
styles/
  paperify.css               the first-class stylesheet (screen + print)
examples/
  sample.md                  demonstrates every feature
  sample.ja.md               Japanese version with lang: ja
  sample.bib                 shared bibliography for the samples
test/
  convert.test.ts            Vitest suite
```

## ライセンス

GPL-3.0-only
