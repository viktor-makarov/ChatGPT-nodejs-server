# Local CSS Files

This folder contains local copies of external CSS libraries to avoid HTTP requests when generating HTML files.

## Files

- `highlight.min.css` - Highlight.js default theme for syntax highlighting
  - Source: https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/default.min.css
  
- `katex.min.css` - KaTeX styles for mathematical formulas
  - Source: https://cdn.jsdelivr.net/npm/katex@0.16.3/dist/katex.min.css

## Usage

These files are automatically loaded by the `markdownToHtml()` function in `../other_func.js`. If the local files are not found or fail to load, the function will fall back to using the CDN links.

## Updating

To update these files to newer versions:

1. Download the new CSS files from their respective CDNs
2. Replace the existing files in this folder
3. Update the version numbers in this README if needed

## Note

The KaTeX CSS file references font files that are not included locally. If you need full offline support for KaTeX fonts, you would also need to download the font files and update the CSS file paths accordingly.
