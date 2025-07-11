// image-processing-cli/process-images.js

const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");
const archiver = require("archiver");
const sharp = require("sharp");
const { program } = require("commander");
const csvWriter = require("csv-writer").createObjectCsvWriter;
const ora = require("ora");
const chalk = require("chalk");
const boxen = require("boxen");
const figlet = require("figlet");
const winston = require("winston");
const ProgressBar = require("progress");

// Check if chalk is available
if (!chalk || !chalk.cyan) {
  console.error(
    "❌ Error: chalk module not properly loaded. Please run: npm install chalk@4.1.2"
  );
  process.exit(1);
}

// Configure logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: "logs/combined.log",
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

// Ensure logs directory exists
const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

program
  .requiredOption("-i, --input <zip>", "Input ZIP file")
  .requiredOption("-o, --output <zip>", "Output ZIP file")
  .requiredOption("-l, --logo <file>", "Watermark logo PNG file")
  .option("-r, --resize <px>", "Resize to square px (default: 1200)", "1200")
  .option("-q, --quality <value>", "WebP quality (default: 80)", "80")
  .option("--csv <file>", "CSV output file")
  .option("--clean", "Clean temp folders after processing", false)
  .option("--keep-temp", "Keep temp_input and temp_output folders", false)
  .option(
    "--concurrent <num>",
    "Number of concurrent processes (default: 4)",
    "4"
  )
  .option(
    "--chunk-size <num>",
    "Process images in chunks (default: 100)",
    "100"
  )
  .option("--max-size <kb>", "Maximum file size in KB (default: 150)", "150")
  .option(
    "--watermark-opacity <value>",
    "Watermark opacity (default: 0.6)",
    "0.6"
  )
  .option(
    "--padding-color <color>",
    "Background padding color (default: white)",
    "white"
  )
  .option("--skip-existing", "Skip files that already exist in output", false);

program.parse(process.argv);

const options = program.opts();

const TEMP_INPUT = path.join(__dirname, "temp_input");
const TEMP_OUTPUT = path.join(__dirname, "temp_output");

// Statistics tracking
const stats = {
  total: 0,
  processed: 0,
  skipped: 0,
  errors: 0,
  startTime: Date.now(),
  totalSize: 0,
  processedSize: 0,
};

// Semaphore for concurrent processing
class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    return new Promise((resolve) => {
      if (this.current < this.max) {
        this.current++;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  release() {
    this.current--;
    if (this.queue.length > 0) {
      this.current++;
      const resolve = this.queue.shift();
      resolve();
    }
  }
}

// Utility functions
function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function getColorFromHex(colorName) {
  const colors = {
    white: { r: 255, g: 255, b: 255, alpha: 1 },
    black: { r: 0, g: 0, b: 0, alpha: 1 },
    gray: { r: 128, g: 128, b: 128, alpha: 1 },
    transparent: { r: 255, g: 255, b: 255, alpha: 0 },
  };
  return colors[colorName] || colors.white;
}

async function showBanner() {
  const banner = figlet.textSync("IMAGE PROCESSOR", {
    font: "Small",
    horizontalLayout: "fitted",
  });

  console.log(chalk.cyan(banner));
  console.log(
    boxen(
      chalk.white.bold("🖼️  Professional Image Processing Suite\n") +
        chalk.gray(
          "Watermarking • Resizing • WebP Conversion • Batch Processing"
        ),
      {
        padding: 1,
        margin: 1,
        borderStyle: "round",
        borderColor: "cyan",
        backgroundColor: "black",
      }
    )
  );
}

async function validateInputs() {
  const spinner = ora("🔍 Validating inputs...").start();

  try {
    // Check input ZIP exists
    if (!fs.existsSync(options.input)) {
      throw new Error(`Input ZIP file not found: ${options.input}`);
    }

    // Check logo exists
    if (!fs.existsSync(options.logo)) {
      throw new Error(`Logo file not found: ${options.logo}`);
    }

    // Validate logo format
    const logoStats = await sharp(options.logo).metadata();
    if (!["png", "jpeg", "jpg", "webp"].includes(logoStats.format)) {
      throw new Error(`Logo must be PNG, JPEG, or WebP format`);
    }

    // Validate numeric options
    const size = parseInt(options.resize);
    const quality = parseInt(options.quality);
    const concurrent = parseInt(options.concurrent);
    const chunkSize = parseInt(options.chunkSize);
    const maxSize = parseInt(options.maxSize);
    const opacity = parseFloat(options.watermarkOpacity);

    if (size < 100 || size > 4000)
      throw new Error("Resize value must be between 100-4000px");
    if (quality < 1 || quality > 100)
      throw new Error("Quality must be between 1-100");
    if (concurrent < 1 || concurrent > 20)
      throw new Error("Concurrent processes must be between 1-20");
    if (chunkSize < 10 || chunkSize > 1000)
      throw new Error("Chunk size must be between 10-1000");
    if (maxSize < 10 || maxSize > 5000)
      throw new Error("Max size must be between 10-5000KB");
    if (opacity < 0 || opacity > 1)
      throw new Error("Watermark opacity must be between 0-1");

    spinner.succeed("✅ All inputs validated successfully");

    // Log configuration
    logger.info("Processing started with configuration:", {
      input: options.input,
      output: options.output,
      logo: options.logo,
      resize: size,
      quality: quality,
      concurrent: concurrent,
      chunkSize: chunkSize,
      maxSize: maxSize,
      watermarkOpacity: opacity,
      paddingColor: options.paddingColor,
    });
  } catch (error) {
    spinner.fail(`❌ Validation failed: ${error.message}`);
    logger.error("Validation failed:", error);
    process.exit(1);
  }
}

async function extractZip(zipPath, destPath) {
  const spinner = ora("📦 Extracting ZIP archive...").start();

  try {
    await fs.promises.mkdir(destPath, { recursive: true });

    await fs
      .createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: destPath }))
      .promise();

    spinner.succeed("✅ ZIP extracted successfully");
    logger.info(`ZIP extracted to: ${destPath}`);
  } catch (error) {
    spinner.fail(`❌ Failed to extract ZIP: ${error.message}`);
    logger.error("ZIP extraction failed:", error);
    throw error;
  }
}

async function getAllImageFiles(dir) {
  const spinner = ora("🔍 Scanning for image files...").start();
  let files = [];

  try {
    const scanDirectory = async (currentDir) => {
      const items = await fs.promises.readdir(currentDir, {
        withFileTypes: true,
      });

      for (const item of items) {
        const fullPath = path.join(currentDir, item.name);

        if (item.isDirectory()) {
          await scanDirectory(fullPath);
        } else if (/\.(jpg|jpeg|png|webp)$/i.test(item.name)) {
          const stat = await fs.promises.stat(fullPath);
          files.push({
            path: fullPath,
            size: stat.size,
            name: item.name,
          });
          stats.totalSize += stat.size;
        }
      }
    };

    await scanDirectory(dir);
    stats.total = files.length;

    spinner.succeed(
      `✅ Found ${chalk.bold(files.length)} image files (${formatBytes(
        stats.totalSize
      )})`
    );
    logger.info(
      `Found ${files.length} image files, total size: ${formatBytes(
        stats.totalSize
      )}`
    );

    return files;
  } catch (error) {
    spinner.fail(`❌ Failed to scan directory: ${error.message}`);
    logger.error("Directory scan failed:", error);
    throw error;
  }
}

async function processImage(
  inputFile,
  outputFile,
  logoPath,
  size,
  quality,
  maxSizeKB,
  opacity,
  paddingColor
) {
  try {
    // Check if output file already exists and skip-existing is enabled
    if (options.skipExisting && fs.existsSync(outputFile)) {
      stats.skipped++;
      logger.info(`Skipped existing file: ${outputFile}`);
      return { skipped: true };
    }

    // Load and resize logo
    const logoSize = Math.floor(size / 5);
    const logo = await sharp(logoPath)
      .resize({ width: logoSize, height: logoSize, fit: "inside" })
      .png()
      .toBuffer();

    // Get padding color
    const bgColor = getColorFromHex(paddingColor);

    // Process main image
    let processedImage = sharp(inputFile)
      .resize({
        fit: "contain",
        width: size,
        height: size,
        background: bgColor,
      })
      .composite([
        {
          input: logo,
          gravity: "southeast",
          blend: "over",
          top: size - logoSize - 10,
          left: size - logoSize - 10,
          opacity: opacity,
        },
      ]);

    // Convert to WebP with initial quality
    let webpBuffer = await processedImage.webp({ quality }).toBuffer();

    // If file is too large, reduce quality iteratively
    let currentQuality = quality;
    const maxSizeBytes = maxSizeKB * 1024;

    while (webpBuffer.length > maxSizeBytes && currentQuality > 10) {
      currentQuality = Math.max(10, currentQuality - 10);
      webpBuffer = await processedImage
        .webp({ quality: currentQuality })
        .toBuffer();
    }

    // Create output directory if it doesn't exist
    await fs.promises.mkdir(path.dirname(outputFile), { recursive: true });

    // Write the processed image
    await fs.promises.writeFile(outputFile, webpBuffer);

    stats.processed++;
    stats.processedSize += webpBuffer.length;

    return {
      success: true,
      originalSize: (await fs.promises.stat(inputFile)).size,
      processedSize: webpBuffer.length,
      quality: currentQuality,
      compression:
        (1 - webpBuffer.length / (await fs.promises.stat(inputFile)).size) *
        100,
    };
  } catch (error) {
    stats.errors++;
    logger.error(`Failed to process image ${inputFile}:`, error);
    throw error;
  }
}

async function processImagesInChunks(
  imageFiles,
  logoPath,
  size,
  quality,
  maxSizeKB,
  opacity,
  paddingColor
) {
  const concurrent = parseInt(options.concurrent);
  const chunkSize = parseInt(options.chunkSize);
  const semaphore = new Semaphore(concurrent);
  const mapping = [];

  // Create progress bar
  const progressBar = new ProgressBar(
    `${chalk.cyan("Processing")} [:bar] ${chalk.green(
      ":percent"
    )} | ${chalk.yellow(":current/:total")} | ${chalk.blue(
      "Rate: :rate/s"
    )} | ${chalk.magenta("ETA: :etas")}`,
    {
      complete: "█",
      incomplete: "░",
      width: 40,
      total: imageFiles.length,
      renderThrottle: 100,
    }
  );

  // Process images in chunks
  for (let i = 0; i < imageFiles.length; i += chunkSize) {
    const chunk = imageFiles.slice(i, i + chunkSize);
    const chunkPromises = chunk.map(async (file) => {
      await semaphore.acquire();

      try {
        const relativePath = path.relative(TEMP_INPUT, file.path);
        const outputPath = path
          .join(TEMP_OUTPUT, relativePath)
          .replace(/\.(jpg|jpeg|png|webp)$/i, ".webp");

        const result = await processImage(
          file.path,
          outputPath,
          logoPath,
          size,
          quality,
          maxSizeKB,
          opacity,
          paddingColor
        );

        if (!result.skipped) {
          mapping.push({
            original: relativePath,
            processed: path.relative(TEMP_OUTPUT, outputPath),
            originalSize: formatBytes(result.originalSize),
            processedSize: formatBytes(result.processedSize),
            compression: `${result.compression.toFixed(1)}%`,
            quality: result.quality,
          });
        }

        progressBar.tick();
      } catch (error) {
        logger.error(`Error processing ${file.path}:`, error);
        progressBar.tick();
      } finally {
        semaphore.release();
      }
    });

    await Promise.all(chunkPromises);
  }

  console.log(); // New line after progress bar

  return mapping;
}

async function zipFolder(sourceFolder, zipPath) {
  const spinner = ora("🗜️  Creating output ZIP...").start();

  try {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    await new Promise((resolve, reject) => {
      output.on("close", resolve);
      archive.on("error", reject);
      archive.pipe(output);
      archive.directory(sourceFolder, false);
      archive.finalize();
    });

    const zipStats = await fs.promises.stat(zipPath);
    spinner.succeed(
      `✅ ZIP created successfully (${formatBytes(zipStats.size)})`
    );
    logger.info(
      `Output ZIP created: ${zipPath}, size: ${formatBytes(zipStats.size)}`
    );
  } catch (error) {
    spinner.fail(`❌ Failed to create ZIP: ${error.message}`);
    logger.error("ZIP creation failed:", error);
    throw error;
  }
}

async function writeCSV(mapping, csvPath) {
  if (!csvPath || mapping.length === 0) return;

  const spinner = ora("📝 Writing CSV mapping...").start();

  try {
    const writer = csvWriter({
      path: csvPath,
      header: [
        { id: "original", title: "Original Path" },
        { id: "processed", title: "Processed Path" },
        { id: "originalSize", title: "Original Size" },
        { id: "processedSize", title: "Processed Size" },
        { id: "compression", title: "Compression" },
        { id: "quality", title: "WebP Quality" },
      ],
    });

    await writer.writeRecords(mapping);
    spinner.succeed(`✅ CSV mapping written to ${csvPath}`);
    logger.info(`CSV mapping written to: ${csvPath}`);
  } catch (error) {
    spinner.fail(`❌ Failed to write CSV: ${error.message}`);
    logger.error("CSV writing failed:", error);
    throw error;
  }
}

async function cleanup() {
  if (options.clean || !options.keepTemp) {
    const spinner = ora("🧹 Cleaning up temporary files...").start();

    try {
      await fs.promises.rm(TEMP_INPUT, { recursive: true, force: true });
      await fs.promises.rm(TEMP_OUTPUT, { recursive: true, force: true });
      spinner.succeed("✅ Cleanup completed");
      logger.info("Temporary files cleaned up");
    } catch (error) {
      spinner.fail(`❌ Cleanup failed: ${error.message}`);
      logger.error("Cleanup failed:", error);
    }
  }
}

function showFinalStats() {
  const duration = Date.now() - stats.startTime;
  const compressionRatio = (
    ((stats.totalSize - stats.processedSize) / stats.totalSize) *
    100
  ).toFixed(1);

  const summary = boxen(
    chalk.white.bold("📊 PROCESSING SUMMARY\n\n") +
      chalk.green(`✅ Successfully processed: ${stats.processed} images\n`) +
      chalk.yellow(`⏭️  Skipped: ${stats.skipped} images\n`) +
      chalk.red(`❌ Errors: ${stats.errors} images\n`) +
      chalk.blue(`📁 Total files: ${stats.total} images\n\n`) +
      chalk.cyan(`📏 Original size: ${formatBytes(stats.totalSize)}\n`) +
      chalk.cyan(`📉 Processed size: ${formatBytes(stats.processedSize)}\n`) +
      chalk.magenta(`🗜️  Compression: ${compressionRatio}%\n\n`) +
      chalk.white(`⏱️  Total time: ${formatTime(duration)}\n`) +
      chalk.white(
        `🚀 Processing rate: ${(stats.processed / (duration / 1000)).toFixed(
          1
        )} images/sec`
      ),
    {
      padding: 1,
      margin: 1,
      borderStyle: "double",
      borderColor: "green",
      backgroundColor: "black",
    }
  );

  console.log(summary);

  // Log final statistics
  logger.info("Processing completed:", {
    processed: stats.processed,
    skipped: stats.skipped,
    errors: stats.errors,
    total: stats.total,
    originalSize: stats.totalSize,
    processedSize: stats.processedSize,
    compressionRatio: compressionRatio,
    duration: duration,
    processingRate: (stats.processed / (duration / 1000)).toFixed(1),
  });
}

// Main execution
(async () => {
  try {
    await showBanner();
    await validateInputs();

    const size = parseInt(options.resize);
    const quality = parseInt(options.quality);
    const maxSizeKB = parseInt(options.maxSize);
    const opacity = parseFloat(options.watermarkOpacity);

    // Cleanup before start
    await fs.promises.rm(TEMP_INPUT, { recursive: true, force: true });
    await fs.promises.rm(TEMP_OUTPUT, { recursive: true, force: true });

    // Extract ZIP
    await extractZip(options.input, TEMP_INPUT);

    // Collect image files
    const imageFiles = await getAllImageFiles(TEMP_INPUT);

    if (imageFiles.length === 0) {
      console.log(chalk.yellow("⚠️  No image files found in the ZIP archive"));
      logger.warn("No image files found in ZIP archive");
      return;
    }

    // Process images in chunks
    const mapping = await processImagesInChunks(
      imageFiles,
      options.logo,
      size,
      quality,
      maxSizeKB,
      opacity,
      options.paddingColor
    );

    // Write CSV mapping
    await writeCSV(mapping, options.csv);

    // Create output ZIP
    await zipFolder(TEMP_OUTPUT, options.output);

    // Show final statistics
    showFinalStats();

    // Cleanup
    await cleanup();

    console.log(
      chalk.green.bold("\n🎉 All done! Your images are ready for upload.")
    );
    console.log(chalk.gray(`📂 Output: ${options.output}`));
    if (options.csv) {
      console.log(chalk.gray(`📊 Mapping: ${options.csv}`));
    }
    console.log(chalk.gray(`📋 Logs: ${path.join(__dirname, "logs")}`));
  } catch (error) {
    console.error("\n💥 Fatal error occurred:", error.message);
    if (error.stack) {
      console.error("Stack trace:", error.stack);
    }
    logger.error("Fatal error:", error);
    process.exit(1);
  }
})().catch((error) => {
  console.error("\n💥 Unhandled error:", error.message);
  logger.error("Unhandled error:", error);
  process.exit(1);
});
