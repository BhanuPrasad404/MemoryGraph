// utils/fileParsers/index.js
const logger = require('../logger');

// Import parsers - handle missing files gracefully
let PDFParser, TextParser, TextCleaner, Constants;

try {
    PDFParser = require('./pdfParser');
} catch (error) {
    logger.warn('PDF parser not available:', error.message);
    PDFParser = { parse: () => ({ success: false, text: '', error: 'PDF parser not loaded' }) };
}

try {
    TextParser = require('./textParser');
} catch (error) {
    logger.warn('Text parser not available:', error.message);
    TextParser = { parse: () => ({ success: false, text: '', error: 'Text parser not loaded' }) };
}

try {
    TextCleaner = require('./cleanText');
} catch (error) {
    logger.warn('Text cleaner not available:', error.message);
    TextCleaner = { 
        clean: (text) => text || '',
        validateText: () => ({ valid: true, length: 0 })
    };
}

try {
    Constants = require('./constants');
} catch (error) {
    logger.warn('Constants not available:', error.message);
    Constants = {
        FILE_TYPES: {
            PDF: '.pdf',
            TXT: '.txt',
            MD: '.md',
            JSON: '.json'
        },
        MAX_FILE_SIZES: {
            pdf: 50 * 1024 * 1024,
            txt: 10 * 1024 * 1024
        }
    };
}

class FileParser {
    constructor() {
        this.parsers = {
            pdf: PDFParser,
            txt: TextParser,
            md: TextParser,
            json: TextParser
        };
        
        this.cleaner = TextCleaner;
        this.constants = Constants;
        
        logger.info('🎯 FileParser initialized');
        logger.info(`📁 Supported types: ${Object.keys(this.parsers).join(', ')}`);
    }

    /**
     * Main parsing method
     */
    async parseFile(fileBuffer, filename, options = {}) {
        const startTime = Date.now();
        
        try {
            if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
                throw new Error('Invalid file buffer');
            }
            
            if (!filename || typeof filename !== 'string') {
                throw new Error('Invalid filename');
            }
            
            logger.info(`📄 Parsing file: ${filename} (${this.formatFileSize(fileBuffer.length)})`);
            
            // Validate file
            const validation = this.validateFile(fileBuffer, filename, options);
            if (!validation.valid) {
                throw new Error(validation.error);
            }
            
            // Get parser
            const fileExt = this.getFileExtension(filename);
            const parser = this.getParser(fileExt);
            
            if (!parser) {
                throw new Error(`Unsupported file type: ${fileExt}`);
            }
            
            // Parse based on file type
            let result;
            if (fileExt === 'pdf') {
                result = await parser.parse(fileBuffer, {
                    tryFallback: true,
                    includeRaw: false,
                    ...options
                });
            } else {
                result = await parser.parse(fileBuffer, filename, {
                    encoding: 'utf-8',
                    includeOriginal: false,
                    ...options
                });
            }
            
            // Ensure result structure
            result = result || {};
            result.success = result.success !== false;
            result.text = result.text || '';
            result.metadata = result.metadata || {};
            
            // Clean text if cleaner is available
            if (this.cleaner && typeof this.cleaner.clean === 'function') {
                try {
                    result.text = this.cleaner.clean(result.text, {
                        removePageNumbers: true,
                        ensureSentenceEndings: true,
                        ...options.cleaning
                    });
                } catch (cleanError) {
                    logger.warn('Text cleaning failed:', cleanError.message);
                }
            }
            
            // Add metadata
            if (result.success) {
                result.metadata.filename = filename;
                result.metadata.file_extension = fileExt;
                result.metadata.file_size = fileBuffer.length;
                result.metadata.file_size_human = this.formatFileSize(fileBuffer.length);
                result.metadata.parsed_at = new Date().toISOString();
                result.metadata.processing_time_ms = Date.now() - startTime;
                
                // Add text stats
                if (result.text) {
                    result.metadata.text_length = result.text.length;
                    result.metadata.word_count = (result.text.match(/\b\w+\b/g) || []).length;
                    result.metadata.line_count = (result.text.match(/\n/g) || []).length + 1;
                }
            }
            
            // Validate extracted text
            if (this.cleaner && typeof this.cleaner.validateText === 'function') {
                try {
                    const textValidation = this.cleaner.validateText(
                        result.text,
                        options.minTextLength || 10,
                        options.maxTextLength || 10 * 1024 * 1024 // 10MB max text
                    );
                    
                    if (!textValidation.valid) {
                        logger.warn(`Text validation warning: ${textValidation.error}`);
                        result.warning = textValidation.error;
                    }
                } catch (validateError) {
                    logger.warn('Text validation failed:', validateError.message);
                }
            }
            
            const totalTime = Date.now() - startTime;
            
            if (result.success) {
                logger.info(`✅ Parsed ${filename}: ${result.text.length} chars in ${totalTime}ms`);
            } else {
                logger.warn(`⚠️ Partial parse for ${filename}: ${result.error || 'Unknown error'}`);
            }
            
            return result;
            
        } catch (error) {
            logger.error(`❌ Failed to parse ${filename || 'unknown file'}:`, error);
            
            return {
                success: false,
                filename: filename,
                error: error.message,
                error_type: error.name || 'ParsingError',
                metadata: {
                    file_size: fileBuffer?.length || 0,
                    file_size_human: this.formatFileSize(fileBuffer?.length || 0),
                    attempted_at: new Date().toISOString(),
                    processing_time_ms: Date.now() - startTime
                }
            };
        }
    }

    /**
     * Parse multiple files
     */
    async parseFiles(fileBuffers, filenames, options = {}) {
        if (!Array.isArray(fileBuffers) || !Array.isArray(filenames)) {
            throw new Error('fileBuffers and filenames must be arrays');
        }
        
        if (fileBuffers.length !== filenames.length) {
            throw new Error('fileBuffers and filenames must have same length');
        }
        
        const results = [];
        const total = fileBuffers.length;
        
        logger.info(`📦 Processing ${total} files in batch`);
        
        for (let i = 0; i < total; i++) {
            try {
                const result = await this.parseFile(
                    fileBuffers[i],
                    filenames[i],
                    options
                );
                results.push(result);
                
                logger.debug(`Processed ${i + 1}/${total}: ${filenames[i]}`);
                
            } catch (error) {
                logger.error(`Failed to parse ${filenames[i]}:`, error.message);
                results.push({
                    success: false,
                    filename: filenames[i],
                    error: error.message
                });
            }
            
            // Delay between files if specified
            if (options.delayBetweenFiles && i < total - 1) {
                await new Promise(resolve => 
                    setTimeout(resolve, options.delayBetweenFiles)
                );
            }
        }
        
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        logger.info(` Batch complete: ${successful} successful, ${failed} failed`);
        
        return {
            total,
            successful,
            failed,
            results
        };
    }

    /**
     * Validate file
     */
    validateFile(buffer, filename, options = {}) {
        // Check buffer
        if (!buffer || !Buffer.isBuffer(buffer)) {
            return { valid: false, error: 'Invalid file buffer' };
        }
        
        if (buffer.length === 0) {
            return { valid: false, error: 'File buffer is empty' };
        }
        
        // Check size
        const maxSize = options.maxFileSize || 
                       (this.constants?.MAX_FILE_SIZES?.default || 50 * 1024 * 1024);
        
        if (buffer.length > maxSize) {
            return {
                valid: false,
                error: `File too large: ${this.formatFileSize(buffer.length)} > ${this.formatFileSize(maxSize)}`
            };
        }
        
        // Check file extension
        const fileExt = this.getFileExtension(filename);
        if (!fileExt) {
            return { valid: false, error: 'File has no extension' };
        }
        
        // Check if supported
        if (!this.isSupportedType(fileExt)) {
            const supported = this.getSupportedTypes();
            return {
                valid: false,
                error: `Unsupported file type: .${fileExt}. Supported: ${supported.map(ext => '.' + ext).join(', ')}`
            };
        }
        
        return { valid: true };
    }

    /**
     * Get parser for file extension
     */
    getParser(fileExt) {
        if (!fileExt) return null;
        
        const normalizedExt = fileExt.toLowerCase();
        
        // Direct mapping
        if (this.parsers[normalizedExt]) {
            return this.parsers[normalizedExt];
        }
        
        // Fallback for text-based files
        const textExtensions = ['txt', 'md', 'json', 'csv', 'xml', 'html', 'htm', 'rtf'];
        if (textExtensions.includes(normalizedExt)) {
            return this.parsers.txt || this.parsers.text;
        }
        
        return null;
    }

    getFileExtension(filename) {
        if (!filename || typeof filename !== 'string') {
            return 'txt';
        }
        
        const parts = filename.split('.');
        if (parts.length < 2) {
            return 'txt'; // Default extension
        }
        
        return parts[parts.length - 1].toLowerCase();
    }

    isSupportedType(fileExt) {
        if (!fileExt) return false;
        
        const supported = this.getSupportedTypes();
        return supported.includes(fileExt.toLowerCase());
    }

    getSupportedTypes() {
        return Object.keys(this.parsers).filter(key => 
            this.parsers[key] && typeof this.parsers[key].parse === 'function'
        );
    }

    /**
     * Extract text (simplified version)
     */
    async extractText(fileBuffer, filename, method = 'auto') {
        try {
            const fileExt = this.getFileExtension(filename);
            const parser = this.getParser(fileExt);
            
            if (!parser) {
                return fileBuffer.toString('utf-8').substring(0, 100000);
            }
            
            const result = await this.parseFile(fileBuffer, filename, {
                maxFileSize: 100 * 1024 * 1024
            });
            
            return result.text || '';
            
        } catch (error) {
            logger.error('Text extraction failed:', error);
            return '';
        }
    }

    getFileInfo(buffer, filename) {
        const fileExt = this.getFileExtension(filename);
        
        return {
            filename: filename,
            extension: fileExt,
            size_bytes: buffer.length,
            size_human: this.formatFileSize(buffer.length),
            supported: this.isSupportedType(fileExt),
            estimated_pages: fileExt === 'pdf' ? this.estimatePDFPages(buffer) : 1,
            mime_type: this.getMimeType(fileExt),
            parser_available: !!this.getParser(fileExt)
        };
    }

    estimatePDFPages(buffer) {
        if (!buffer || buffer.length < 100) return 0;
        
        // Rough estimation: ~4KB per page
        const pages = Math.floor(buffer.length / 4096);
        return Math.max(1, Math.min(pages, 1000)); // Cap at 1000 pages
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        
        return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
    }

    getMimeType(fileExt) {
        const mimeMap = {
            'pdf': 'application/pdf',
            'txt': 'text/plain',
            'md': 'text/markdown',
            'json': 'application/json',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'doc': 'application/msword',
            'csv': 'text/csv',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'xls': 'application/vnd.ms-excel',
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif'
        };
        
        return mimeMap[fileExt.toLowerCase()] || 'application/octet-stream';
    }

    async healthCheck() {
        const checks = {
            pdf: { healthy: false, error: 'Not checked' },
            text: { healthy: false, error: 'Not checked' },
            cleaner: { healthy: false, error: 'Not checked' }
        };
        
        // Check PDF parser
        try {
            if (PDFParser && typeof PDFParser.healthCheck === 'function') {
                checks.pdf = await PDFParser.healthCheck();
            } else {
                checks.pdf = { healthy: true, note: 'Basic PDF parser available' };
            }
        } catch (error) {
            checks.pdf = { healthy: false, error: error.message };
        }
        
        // Check Text parser
        try {
            if (TextParser && typeof TextParser.healthCheck === 'function') {
                checks.text = await TextParser.healthCheck();
            } else {
                checks.text = { healthy: true, note: 'Basic text parser available' };
            }
        } catch (error) {
            checks.text = { healthy: false, error: error.message };
        }
        
        // Check Text cleaner
        try {
            if (TextCleaner && typeof TextCleaner.clean === 'function') {
                const testText = 'Health check';
                const cleaned = TextCleaner.clean(testText);
                checks.cleaner = { 
                    healthy: true,
                    note: `Cleaner working (${testText} → ${cleaned})`
                };
            } else {
                checks.cleaner = { healthy: false, error: 'Text cleaner not available' };
            }
        } catch (error) {
            checks.cleaner = { healthy: false, error: error.message };
        }
        
        const overallHealthy = checks.pdf.healthy && checks.text.healthy && checks.cleaner.healthy;
        
        return {
            healthy: overallHealthy,
            timestamp: new Date().toISOString(),
            supported_types: this.getSupportedTypes(),
            services: checks
        };
    }

    async parseFilesWithProgress(fileBuffers, filenames, options = {}, progressCallback) {
        if (!progressCallback || typeof progressCallback !== 'function') {
            return await this.parseFiles(fileBuffers, filenames, options);
        }
        
        const results = [];
        const total = fileBuffers.length;
        
        for (let i = 0; i < total; i++) {
            // Send progress update
            progressCallback({
                current: i + 1,
                total: total,
                filename: filenames[i],
                percent: Math.round(((i + 1) / total) * 100),
                status: 'processing'
            });
            
            try {
                const result = await this.parseFile(
                    fileBuffers[i],
                    filenames[i],
                    options
                );
                results.push(result);
                
                // Send completion update for this file
                progressCallback({
                    current: i + 1,
                    total: total,
                    filename: filenames[i],
                    percent: Math.round(((i + 1) / total) * 100),
                    status: result.success ? 'success' : 'failed',
                    file_result: result
                });
                
            } catch (error) {
                logger.error(`Failed to parse ${filenames[i]}:`, error);
                results.push({
                    success: false,
                    filename: filenames[i],
                    error: error.message
                });
                
                progressCallback({
                    current: i + 1,
                    total: total,
                    filename: filenames[i],
                    percent: Math.round(((i + 1) / total) * 100),
                    status: 'error',
                    error: error.message
                });
            }
            
            // Delay if specified
            if (options.delayBetweenFiles && i < total - 1) {
                await new Promise(resolve => 
                    setTimeout(resolve, options.delayBetweenFiles)
                );
            }
        }
        
        // Final completion
        progressCallback({
            completed: true,
            total: total,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            status: 'complete'
        });
        
        return results;
    }
}

// Export singleton instance
module.exports = new FileParser();