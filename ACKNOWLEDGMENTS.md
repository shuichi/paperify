# Acknowledgments

Portions of Paperify use the following open-source software. We gratefully
acknowledge the authors, maintainers, and contributors of these projects.

The versions below are the versions resolved in `package-lock.json`. This list
covers the direct runtime dependencies declared in the `dependencies` section
of `package.json`; development-only dependencies are not included.

## Citations and bibliographies

| Library | Version | License | Use in Paperify |
| --- | ---: | --- | --- |
| [@citation-js/plugin-bibtex](https://www.npmjs.com/package/@citation-js/plugin-bibtex) | 0.7.21 | MIT | BibTeX input support for Citation.js |
| [@citation-js/plugin-csl](https://www.npmjs.com/package/@citation-js/plugin-csl) | 0.7.22 | MIT | CSL data and locale support for Citation.js |
| [citation-js](https://www.npmjs.com/package/citation-js) | 0.7.22 | MIT | Bibliographic data parsing and normalization |
| [citeproc](https://www.npmjs.com/package/citeproc) | 2.4.63 | CPAL-1.0 OR AGPL-1.0 | CSL citation and bibliography rendering |

## Markdown and HTML processing

| Library | Version | License | Use in Paperify |
| --- | ---: | --- | --- |
| [gray-matter](https://www.npmjs.com/package/gray-matter) | 4.0.3 | MIT | YAML frontmatter extraction |
| [mdast-util-directive](https://www.npmjs.com/package/mdast-util-directive) | 3.1.0 | MIT | Markdown directive node support |
| [rehype-highlight](https://www.npmjs.com/package/rehype-highlight) | 7.0.2 | MIT | Static syntax highlighting |
| [rehype-katex](https://www.npmjs.com/package/rehype-katex) | 7.0.1 | MIT | Static math rendering in the HTML pipeline |
| [rehype-raw](https://www.npmjs.com/package/rehype-raw) | 7.0.0 | MIT | Parsing enabled raw HTML |
| [rehype-sanitize](https://www.npmjs.com/package/rehype-sanitize) | 6.0.0 | MIT | Sanitizing enabled raw HTML |
| [rehype-slug](https://www.npmjs.com/package/rehype-slug) | 6.0.0 | MIT | Stable heading IDs |
| [rehype-stringify](https://www.npmjs.com/package/rehype-stringify) | 10.0.1 | MIT | HTML serialization |
| [remark-directive](https://www.npmjs.com/package/remark-directive) | 4.0.0 | MIT | Figure and video directive parsing |
| [remark-gfm](https://www.npmjs.com/package/remark-gfm) | 4.0.1 | MIT | GitHub Flavored Markdown support |
| [remark-math](https://www.npmjs.com/package/remark-math) | 6.0.0 | MIT | Markdown math syntax support |
| [remark-parse](https://www.npmjs.com/package/remark-parse) | 11.0.0 | MIT | Markdown parsing |
| [remark-rehype](https://www.npmjs.com/package/remark-rehype) | 11.1.2 | MIT | Markdown-to-HTML syntax tree conversion |
| [unified](https://www.npmjs.com/package/unified) | 11.0.5 | MIT | Markdown and HTML processing pipeline |
| [unist-util-visit](https://www.npmjs.com/package/unist-util-visit) | 5.1.0 | MIT | Syntax tree traversal |
| [vfile](https://www.npmjs.com/package/vfile) | 6.0.3 | MIT | Virtual-file data and build messages |

## Rendering and output

| Library | Version | License | Use in Paperify |
| --- | ---: | --- | --- |
| [KaTeX](https://www.npmjs.com/package/katex) | 0.17.0 | MIT | Math markup, styles, and fonts |
| [Mermaid](https://www.npmjs.com/package/mermaid) | 11.16.0 | MIT | Static diagram rendering |
| [Puppeteer](https://www.npmjs.com/package/puppeteer) | 25.3.0 | Apache-2.0 | Browser automation for Mermaid rendering and PDF output |

Each project remains subject to its own license terms. Complete license and
copyright notices are provided by the respective packages and linked project
pages. Transitive dependencies and their notices can be inspected in the
installed dependency tree recorded by `package-lock.json`.
