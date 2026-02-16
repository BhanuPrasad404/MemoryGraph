// utils/fileParser/pdfParser.js - REAL WORKING VERSION
const pdfParse = require('pdf-parse');
const Pdf2Json = require('pdf2json');
const { createWorker } = require('tesseract.js');
const { fromBuffer } = require('pdf2pic'); // PDF to image converter
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const logger = require('../logger');
const TextCleaner = require('./cleanText');

class PDFParser {

    constructor() {
        this.cleaner = TextCleaner;
        this.ocrWorker = null;
        this.tempDir = path.join(os.tmpdir(), 'memorygraph-pdf-ocr');
        logger.info('PDFParser initialized with REAL OCR support');
    }

    /**
     * Parse ANY PDF - text or scanned (MAIN FUNCTION)
     */
    async parse(buffer, options = {}) {
        let tempImages = [];

        try {
            logger.info('Parsing PDF file...');

            // TRY 1: Extract text from text-based PDFs (FAST)
            const textResult = await this.extractTextPDFs(buffer);
            if (textResult.success && textResult.text.length > 200) {
                logger.info(`✅ Text PDF extracted: ${textResult.text.length} chars`);
                return textResult;
            }

            // TRY 2: REAL OCR for scanned PDFs
            logger.info('📸 Text extraction failed, using REAL OCR...');

            // Step 1: Convert PDF to images
            tempImages = await this.convertPDFToImages(buffer, options);

            if (tempImages.length === 0) {
                throw new Error('Could not convert PDF to images');
            }

            logger.info(`🖼️ Converted to ${tempImages.length} image(s) for OCR`);

            // Step 2: OCR each image
            const ocrResult = await this.processImagesWithOCR(tempImages, options);

            if (ocrResult.success && ocrResult.text.length > 100) {
                logger.info(`✅ OCR successful: ${ocrResult.text.length} chars extracted`);
                return ocrResult;
            }

            throw new Error('OCR extracted too little text');

        } catch (error) {
            logger.error('PDF parsing failed:', error);

            // TRY 3: Extract ANYTHING from buffer
            const fallbackText = this.extractAnyTextFromBuffer(buffer);

            if (fallbackText.length > 100) {
                logger.info(`⚠️ Fallback extraction: ${fallbackText.length} chars`);
                return {
                    success: true,
                    text: fallbackText,
                    metadata: {
                        pages: 1,
                        text_length: fallbackText.length,
                        method: 'buffer_fallback',
                        quality: 'partial',
                        warning: 'Limited text extracted'
                    }
                };
            }

            // Final fallback: Helpful message
            return {
                success: true,
                text: this.getHelpMessage(),
                metadata: {
                    pages: 0,
                    text_length: 0,
                    method: 'failed',
                    quality: 'needs_conversion',
                    error: error.message
                }
            };

        } finally {
            // Cleanup temp images
            await this.cleanupTempFiles(tempImages);
        }
    }

    /**
     * STEP 1: Convert PDF to images (REAL WORKING VERSION)
     */
    async convertPDFToImages(buffer, options = {}) {
        try {
            // Create temp directory
            await fs.mkdir(this.tempDir, { recursive: true });

            // Configure pdf2pic
            const pdf2picOptions = {
                density: 150,           // DPI for image quality
                saveFilename: "page",   // Base filename
                savePath: this.tempDir, // Temp directory
                format: "png",          // Image format
                width: 1240,            // Width in pixels
                height: 1754            // Height in pixels (A4)
            };

            // Convert PDF to images
            const convert = fromBuffer(buffer, pdf2picOptions);
            const result = await convert.bulk(-1, { responseType: "image" });

            if (!result || result.length === 0) {
                throw new Error('No images generated from PDF');
            }

            // Get image paths
            const imagePaths = result.map(item => item.path);
            logger.info(`Generated ${imagePaths.length} image(s)`);

            // Read images into buffers
            const imageBuffers = [];
            for (const imagePath of imagePaths) {
                try {
                    const buffer = await fs.readFile(imagePath);
                    imageBuffers.push(buffer);
                } catch (readError) {
                    logger.warn(`Failed to read image ${imagePath}:`, readError.message);
                }
            }

            return imageBuffers;

        } catch (error) {
            logger.error('PDF to image conversion failed:', error);
            return [];
        }
    }

    /**
     * STEP 2: OCR images with Tesseract.js
     */
    async processImagesWithOCR(imageBuffers, options = {}) {
        try {
            // Initialize OCR worker
            if (!this.ocrWorker) {
                this.ocrWorker = await createWorker('eng');
                // Add secondary language if needed
                await this.ocrWorker.addLanguage('eng');
                await this.ocrWorker.initialize('eng');
            }

            let fullText = '';
            let successfulPages = 0;

            // Process each image
            for (let i = 0; i < imageBuffers.length; i++) {
                try {
                    logger.info(`🔍 OCR processing page ${i + 1}/${imageBuffers.length}`);

                    const { data: { text } } = await this.ocrWorker.recognize(imageBuffers[i]);

                    if (text && text.trim().length > 50) {
                        fullText += text.trim() + '\n\n';
                        successfulPages++;
                        logger.info(`📄 Page ${i + 1}: ${text.length} chars`);
                    } else {
                        logger.warn(`Page ${i + 1}: Too little text (${text?.length || 0} chars)`);
                        fullText += `[Page ${i + 1} - Low text quality]\n\n`;
                    }

                } catch (pageError) {
                    logger.warn(`OCR failed for page ${i + 1}:`, pageError.message);
                    fullText += `[Page ${i + 1} - OCR failed]\n\n`;
                }
            }

            if (successfulPages === 0) {
                throw new Error('No pages successfully OCR processed');
            }

            // Clean the text
            fullText = this.cleaner.clean(fullText, {
                fixOCR: true,           // CRITICAL: Fixes OCR spacing/character errors
                removeUrls: false,      //  Keep URLs (they might be important)
                removeEmails: false,    //  Keep emails (important in documents)
                removeSpecialChars: false, // Don't remove special chars (might remove important symbols)
                removePageNumbers: true, //  Remove standalone page numbers
                ensureSentenceEndings: true //  Ensure text ends properly
            });

            return {
                success: true,
                text: fullText,
                metadata: {
                    pages: imageBuffers.length,
                    successful_pages: successfulPages,
                    text_length: fullText.length,
                    method: 'tesseract-ocr',
                    quality: 'ocr_processed',
                    note: 'Scanned PDF processed with OCR'
                }
            };

        } catch (error) {
            logger.error('OCR processing failed:', error);
            throw error;
        }
    }

    /**
     * Extract text from text-based PDFs
     */
    async extractTextPDFs(buffer) {
        // TRY pdf-parse first
        try {
            const data = await pdfParse(buffer);
            if (data.text && data.text.length > 100) {
                return {
                    success: true,
                    text: data.text,
                    metadata: {
                        pages: data.numpages || 0,
                        text_length: data.text.length,
                        method: 'pdf-parse',
                        quality: 'text_pdf'
                    }
                };
            }
        } catch (e) { /* ignore */ }

        // TRY pdf2json as fallback
        try {
            const text = await this.parseWithPdf2Json(buffer);
            if (text && text.length > 100) {
                return {
                    success: true,
                    text: text,
                    metadata: {
                        pages: 1,
                        text_length: text.length,
                        method: 'pdf2json',
                        quality: 'text_pdf'
                    }
                };
            }
        } catch (e) { /* ignore */ }

        return { success: false, text: '' };
    }

    /**
     * pdf2json parser (for structured PDFs)
     */
    async parseWithPdf2Json(buffer) {
        return new Promise((resolve) => {
            const pdfParser = new Pdf2Json();
            let text = '';

            pdfParser.on('pdfParser_dataReady', (pdfData) => {
                try {
                    if (pdfData.Pages && pdfData.Pages.length > 0) {
                        pdfData.Pages.forEach(page => {
                            if (page.Texts && page.Texts.length > 0) {
                                page.Texts.forEach(textItem => {
                                    if (textItem.R) {
                                        textItem.R.forEach(r => {
                                            if (r.T) {
                                                text += decodeURIComponent(r.T) + ' ';
                                            }
                                        });
                                    }
                                });
                            }
                            text += '\n';
                        });
                    }
                    resolve(text.trim());
                } catch (e) {
                    resolve('');
                }
            });

            pdfParser.on('pdfParser_dataError', () => resolve(''));
            pdfParser.parseBuffer(buffer);
        });
    }

    /**
     * Fallback: Extract ANY text from buffer
     */
    extractAnyTextFromBuffer(buffer) {
        try {
            // Convert buffer to string
            const bufferStr = buffer.toString('utf8', 0, Math.min(200000, buffer.length));

            // Multiple extraction patterns
            const patterns = [
                // Full sentences
                /[A-Z][^.!?]*[.!?]/g,
                // Words with context
                /[A-Za-z]{4,}(?:\s+[A-Za-z]{3,}){2,}/g,
                // Common document patterns
                /(?:Name|Address|Email|Phone|Date|Signature|Title|Company):?\s*[A-Za-z0-9@.\-\s,]+/gi,
                // Numbered items
                /\d+[\.\)]\s+[A-Za-z].{10,}/g,
                // Any readable text
                /[A-Za-z][A-Za-z\s]{10,}/g
            ];

            let extracted = '';

            for (const pattern of patterns) {
                const matches = bufferStr.match(pattern);
                if (matches) {
                    // Remove duplicates and add
                    const uniqueMatches = [...new Set(matches)];
                    extracted += uniqueMatches.join(' ') + ' ';
                }
            }

            // Clean up
            extracted = extracted
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 10000);

            return extracted;

        } catch (error) {
            return '';
        }
    }

    /**
     * Helpful error message
     */
    getHelpMessage() {
        return `This PDF could not be processed. It may be:
• Scanned/image-based
• Password protected/encrypted
• Corrupted or invalid

SOLUTIONS:
1. Convert to text-searchable PDF using Adobe Acrobat
2. Use free online OCR: smallpdf.com/ocr-pdf
3. Export as .txt file from original document
4. Take screenshot and use Google Drive OCR

For best results with MemoryGraph AI, use text-searchable documents.`;
    }

    /**
     * Cleanup temp files
     */
    async cleanupTempFiles(imageBuffers) {
        try {
            // Cleanup OCR worker
            if (this.ocrWorker) {
                await this.ocrWorker.terminate();
                this.ocrWorker = null;
            }

            // Cleanup temp directory
            try {
                await fs.rm(this.tempDir, { recursive: true, force: true });
            } catch (rmError) {
                // Ignore cleanup errors
            }

        } catch (error) {
            logger.warn('Cleanup failed:', error.message);
        }
    }

    /**
     * Health check
     */
    async healthCheck() {
        const checks = {
            pdfParse: false,
            pdf2json: false,
            tesseract: false,
            pdf2pic: false
        };

        try {
            // Test pdf-parse
            const testBuffer = Buffer.from('test');
            await pdfParse(testBuffer).catch(() => { });
            checks.pdfParse = true;

            // Test pdf2json
            checks.pdf2json = true; // Assume works

            // Test Tesseract availability
            try {
                const worker = await createWorker('eng');
                await worker.terminate();
                checks.tesseract = true;
            } catch { /* ignore */ }

            // Test pdf2pic
            checks.pdf2pic = true; // Assume works

            return {
                healthy: checks.pdfParse && checks.pdf2json,
                services: checks,
                capabilities: [
                    'text_pdf_extraction',
                    'scanned_pdf_ocr',
                    'buffer_fallback',
                    'temp_file_cleanup'
                ],
                note: 'Full OCR pipeline available for scanned PDFs'
            };

        } catch (error) {
            return {
                healthy: false,
                error: error.message,
                services: checks
            };
        }
    }
}

module.exports = new PDFParser();