# 🖼️ Product Image Processing CLI

A Node.js script to automate product image optimization: watermarking, resizing, converting to WebP, and packaging into a ZIP file. Ideal for Shopify and e-commerce image prep.

---

## 📦 Features

- ✅ Batch watermark images (bottom-right)
- 🖼 Resize/crop to fixed square aspect ratio
- 🌐 Convert to WebP (compressed)
- 🗂 Preserve folder structure
- 📁 Re-zip processed images for easy upload
- 📝 Optional CSV mapping of original → processed filenames
- 🚮 Clean up or preserve temp folders
- 📊 CLI progress bar while processing

---

## 📁 Folder Structure

```
image-processing-cli/
├── process-images.js        # Main script
├── assets/
│   └── logo.png             # Your watermark logo file
├── client_input.zip         # Raw ZIP from client
├── processed_images.zip     # Final ZIP (output)
├── mapping.csv              # Optional filename map
├── README.md                # This file
├── package.json             # Dependencies
```

---

## 🚀 How to Run

1. **Install Node.js dependencies:**

```bash
npm install
```

2. **Run the script:**

```bash
node process-images.js \
  --input ./client_input.zip \
  --output ./processed_images.zip \
  --logo ./assets/logo.png \
  --resize 1200 \
  --quality 80 \
  --csv ./mapping.csv \
  --clean

## ⚙️ Advanced Tips

- Increase `--concurrent` for faster processing on powerful machines
- Use `--chunk-size` to control memory usage in large batches
- `--skip-existing` is useful for incremental updates
- Adjust `--max-size` to fit image requirements of specific platforms
  node process-images.js \
  --input ./client_input.zip \
  --output ./processed_images.zip \
  --logo ./assets/logo.png \
  --resize 1200 \
  --quality 80 \
  --csv ./mapping.csv \
  --max-size 150 \
  --concurrent 4 \
  --chunk-size 100 \
  --watermark-opacity 0.6 \
  --padding-color white \
  --clean

```

---

## 🔧 CLI Options

| Option                | Description                                                           |
| --------------------- | --------------------------------------------------------------------- |
| `--input`             | ✅ Required: Path to input ZIP file from client                       |
| `--output`            | ✅ Required: Path to output ZIP file                                  |
| `--logo`              | ✅ Required: PNG watermark logo to place bottom-right                 |
| `--resize`            | Resize to fixed square size (default: 1200x1200)                      |
| `--quality`           | WebP quality (default: 80)                                            |
| `--csv`               | (Optional) Path to save CSV mapping file                              |
| `--clean`             | Delete temp_input and temp_output folders after script runs           |
| `--keep-temp`         | Keep temp_input and temp_output folders (useful for debugging)        |
| `--concurrent`        | Number of concurrent image processes (default: 4)                     |
| `--chunk-size`        | Number of images to process in each chunk (default: 100)              |
| `--max-size`          | Max output file size in KB (WebP compression target, default: 150 KB) |
| `--watermark-opacity` | Watermark transparency level (default: 0.6)                           |
| `--padding-color`     | Background color for square padding (default: white)                  |
| `--skip-existing`     | Skip processing images that already exist in the output folder        |

> 📝 `--clean` and `--keep-temp` are mutually exclusive. Default behavior is `--clean`.

---

## 📊 Progress

The script displays a real-time CLI progress bar showing how many images have been processed.

---

## ✅ Output

- ✅ `processed_images.zip`: optimized and ready for upload
- 📝 `mapping.csv`: (optional) tracks filenames

---

## 📌 Notes

- Script auto-extracts the input ZIP and processes recursively
- Keeps the same folder structure inside the ZIP
- Watermark auto-scales to image size (1/5 width, 60% opacity)
- Resize uses white background padding to maintain square ratio

---

## 📄 License

MIT
