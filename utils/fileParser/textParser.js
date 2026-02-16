// utils/fileParsers/textParser.js
const logger = require('../logger');
const TextCleaner = require('./cleanText');

class TextParser {
    constructor() {
        this.cleaner = TextCleaner;
        logger.info('TextParser initialized');
    }

    /**
     * Parse text files (TXT, MD, JSON, etc.)
     */
    async parse(buffer, filename, options = {}) {
        try {
            const fileExt = this.getFileExtension(filename);
            const encoding = options.encoding || 'utf-8';
            
            logger.info(`Parsing ${fileExt.toUpperCase()} file: ${filename}`);
            
            // Decode buffer to text
            let text = buffer.toString(encoding);
            
            // Handle different file types
            switch (fileExt) {
                case 'json':
                    return this.parseJSON(text, options);
                case 'md':
                    return this.parseMarkdown(text, options);
                case 'txt':
                default:
                    return this.parsePlainText(text, options);
            }
            
        } catch (error) {
            logger.error('Text parsing error:', error);
            throw new Error(`Text parsing failed: ${error.message}`);
        }
    }

    /**
     * Parse plain text files
     */
    async parsePlainText(text, options = {}) {
        const startTime = Date.now();
        
        // Clean the text
        const cleaned = this.cleaner.clean(text, {
            removeUrls: options.removeUrls || false,
            removeEmails: options.removeEmails || false,
            ensureSentenceEndings: true
        });
        
        const analysis = this.cleaner.analyzeText(cleaned);
        
        return {
            success: true,
            text: cleaned,
            metadata: {
                file_type: 'text',
                encoding: 'utf-8',
                text_length: cleaned.length,
                processing_time: Date.now() - startTime,
                analysis: analysis
            },
            structure: this.analyzeTextStructure(cleaned)
        };
    }

    /**
     * Parse JSON files
     */
    async parseJSON(text, options = {}) {
        try {
            const startTime = Date.now();
            
            // Parse JSON
            const jsonData = JSON.parse(text);
            
            // Convert JSON to readable text
            const jsonText = this.jsonToText(jsonData, options);
            
            // Clean the text
            const cleaned = this.cleaner.clean(jsonText, {
                ensureSentenceEndings: true
            });
            
            const analysis = this.cleaner.analyzeText(cleaned);
            
            return {
                success: true,
                text: cleaned,
                original_json: options.includeOriginal ? jsonData : undefined,
                metadata: {
                    file_type: 'json',
                    encoding: 'utf-8',
                    text_length: cleaned.length,
                    processing_time: Date.now() - startTime,
                    analysis: analysis,
                    json_structure: this.analyzeJSONStructure(jsonData)
                },
                structure: this.analyzeTextStructure(cleaned)
            };
            
        } catch (error) {
            logger.error('JSON parsing error:', error);
            
            // If JSON parsing fails, treat as plain text
            if (options.fallbackToText) {
                logger.warn('JSON parsing failed, falling back to text parsing');
                return await this.parsePlainText(text, options);
            }
            
            throw new Error(`JSON parsing failed: ${error.message}`);
        }
    }

    /**
     * Parse Markdown files
     */
    async parseMarkdown(text, options = {}) {
        const startTime = Date.now();
        
        // Extract text from markdown (remove markdown syntax)
        const plainText = this.markdownToText(text);
        
        // Clean the text
        const cleaned = this.cleaner.clean(plainText, {
            ensureSentenceEndings: true
        });
        
        const analysis = this.cleaner.analyzeText(cleaned);
        
        // Extract markdown structure
        const structure = this.extractMarkdownStructure(text);
        
        return {
            success: true,
            text: cleaned,
            markdown_structure: structure,
            metadata: {
                file_type: 'markdown',
                encoding: 'utf-8',
                text_length: cleaned.length,
                processing_time: Date.now() - startTime,
                analysis: analysis,
                has_headers: structure.headers.length > 0,
                has_lists: structure.lists.length > 0,
                has_code: structure.codeBlocks.length > 0
            },
            structure: this.analyzeTextStructure(cleaned)
        };
    }

    /**
     * Convert JSON to readable text
     */
    jsonToText(jsonData, options = {}, depth = 0) {
        if (depth > options.maxDepth || 10) {
            return '[Deep Structure...]';
        }
        
        if (typeof jsonData === 'string') {
            return jsonData;
        } else if (typeof jsonData === 'number' || typeof jsonData === 'boolean') {
            return jsonData.toString();
        } else if (jsonData === null || jsonData === undefined) {
            return '';
        } else if (Array.isArray(jsonData)) {
            return jsonData.map(item => this.jsonToText(item, options, depth + 1)).join('. ');
        } else if (typeof jsonData === 'object') {
            const entries = Object.entries(jsonData);
            return entries.map(([key, value]) => {
                const valueText = this.jsonToText(value, options, depth + 1);
                return `${key}: ${valueText}`;
            }).join('. ');
        }
        return '';
    }
    /**
     * Convert markdown to plain text
     */
    markdownToText(markdown) {
        // Remove markdown headers
        let text = markdown.replace(/^#+\s+/gm, '');
        
        // Remove code blocks
        text = text.replace(/```[\s\S]*?```/g, '');
        text = text.replace(/`[^`]*`/g, '');
        
        // Remove images and links (keep link text)
        text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
        text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        
        // Remove bold/italic markers
        text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
        text = text.replace(/(\*|_)(.*?)\1/g, '$2');
        
        // Remove blockquotes
        text = text.replace(/^\s*>+/gm, '');
        
        // Remove horizontal rules
        text = text.replace(/^\s*[-*_]{3,}\s*$/gm, '');
        
        // Clean up extra whitespace
        text = this.cleaner.normalizeWhitespace(text);
        
        return text;
    }

    /**
     * Extract markdown structure
     */
    extractMarkdownStructure(markdown) {
        const lines = markdown.split('\n');
        const structure = {
            headers: [],
            lists: [],
            codeBlocks: [],
            tables: []
        };
        
        let inCodeBlock = false;
        let codeBlockStart = -1;
        
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            
            // Detect code blocks
            if (trimmed.startsWith('```')) {
                if (inCodeBlock) {
                    // End of code block
                    structure.codeBlocks.push({
                        start: codeBlockStart,
                        end: index,
                        language: trimmed.substring(3) || 'unknown'
                    });
                    inCodeBlock = false;
                } else {
                    // Start of code block
                    inCodeBlock = true;
                    codeBlockStart = index;
                }
                return;
            }
            
            if (inCodeBlock) return;
            
            // Detect headers
            const headerMatch = trimmed.match(/^(#+)\s+(.+)/);
            if (headerMatch) {
                const level = headerMatch[1].length;
                const text = headerMatch[2];
                structure.headers.push({
                    text: text,
                    level: level,
                    line: index
                });
            }
            
            // Detect lists
            if (/^[\-\*\+]\s/.test(trimmed) || /^\d+[\.\)]\s/.test(trimmed)) {
                structure.lists.push({
                    text: trimmed,
                    line: index,
                    type: /^\d/.test(trimmed) ? 'numbered' : 'bulleted'
                });
            }
            
            // Detect tables (simplified)
            if (trimmed.includes('|') && trimmed.split('|').length > 2) {
                structure.tables.push({
                    line: index,
                    columns: trimmed.split('|').length - 1
                });
            }
        });
        
        return structure;
    }

    /**
     * Analyze JSON structure
     */
    analyzeJSONStructure(jsonData) {
        const analyze = (obj, path = '') => {
            if (typeof obj === 'string') {
                return { type: 'string', path };
            } else if (typeof obj === 'number') {
                return { type: 'number', path };
            } else if (typeof obj === 'boolean') {
                return { type: 'boolean', path };
            } else if (obj === null) {
                return { type: 'null', path };
            } else if (Array.isArray(obj)) {
                const childTypes = obj.length > 0 
                    ? analyze(obj[0], `${path}[]`) 
                    : { type: 'empty_array' };
                return { type: 'array', length: obj.length, childTypes };
            } else if (typeof obj === 'object') {
                const keys = Object.keys(obj);
                const children = keys.map(key => 
                    analyze(obj[key], path ? `${path}.${key}` : key)
                );
                return { type: 'object', keys, children };
            }
            return { type: 'unknown', path };
        };
        
        return analyze(jsonData);
    }

    /**
     * Analyze text structure
     */
    analyzeTextStructure(text) {
        const paragraphs = this.cleaner.splitParagraphs(text, 0);
        const sentences = this.cleaner.extractSentences(text);
        
        return {
            paragraph_count: paragraphs.length,
            sentence_count: sentences.length,
            avg_paragraph_length: paragraphs.length > 0 
                ? text.length / paragraphs.length 
                : 0,
            avg_sentence_length: sentences.length > 0
                ? text.length / sentences.length
                : 0
        };
    }

    /**
     * Get file extension
     */
    getFileExtension(filename) {
        return filename.toLowerCase().split('.').pop() || 'txt';
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            const testText = 'This is a test text for health check. It contains multiple sentences.';
            const parsed = await this.parsePlainText(testText);
            
            return {
                healthy: parsed.success,
                capabilities: ['txt', 'md', 'json'],
                test_parse: parsed.metadata.analysis
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message
            };
        }
    }
}

module.exports = new TextParser();