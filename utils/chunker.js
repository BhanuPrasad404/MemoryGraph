// utils/chunker.js
const logger = require('./logger');

class Chunker {
    constructor() {
        logger.info('Chunker initialized');
    }

    /**
     * Create overlapping chunks from text
     */
    createChunks(text, chunkSize = 500, overlap = 50) {
        if (!text || text.length === 0) {
            return [];
        }

        // SAFETY: Limit text size
        if (text.length > 1000000) { // 1MB max
            logger.warn(`Text too large (${text.length} chars), truncating`);
            text = text.substring(0, 1000000);
        }

        const chunks = [];
        let start = 0;
        let chunkIndex = 0;

        while (start < text.length) {
            // Simple: just cut at chunkSize
            const end = Math.min(start + chunkSize, text.length);
            const content = text.substring(start, end).trim();

            if (content.length > 10) { // Minimum 10 chars
                chunks.push({
                    content: content,
                    start: start,
                    end: end,
                    index: chunkIndex
                });
                chunkIndex++;
            }

            // Move forward (chunkSize - overlap)
            start += chunkSize - overlap;

            // Safety: prevent infinite loop
            if (chunks.length > 1000) {
                logger.warn('Too many chunks, stopping at 1000');
                break;
            }
        }

        logger.info(`Created ${chunks.length} chunks from ${text.length} chars`);
        return chunks;
    }

    /**
     * Create chunks by paragraphs
     */
    createParagraphChunks(text, maxParagraphsPerChunk = 3) {
        const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        const chunks = [];

        for (let i = 0; i < paragraphs.length; i += maxParagraphsPerChunk) {
            const chunkParagraphs = paragraphs.slice(i, i + maxParagraphsPerChunk);
            const content = chunkParagraphs.join('\n\n').trim();

            if (content.length > 0) {
                chunks.push({
                    content: content,
                    paragraph_start: i,
                    paragraph_end: Math.min(i + maxParagraphsPerChunk, paragraphs.length) - 1,
                    length: content.length,
                    index: chunks.length
                });
            }
        }

        logger.info(`Created ${chunks.length} paragraph-based chunks`);
        return chunks;
    }

    /**
     * Create semantic chunks (attempt to keep related content together)
     */
    createSemanticChunks(text, maxChunkSize = 500) {
        // Simple implementation - can be enhanced with NLP later
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        const chunks = [];
        let currentChunk = '';

        for (const sentence of sentences) {
            if ((currentChunk.length + sentence.length) <= maxChunkSize) {
                currentChunk += sentence;
            } else {
                if (currentChunk.trim().length > 0) {
                    chunks.push({
                        content: currentChunk.trim(),
                        length: currentChunk.trim().length,
                        index: chunks.length
                    });
                }
                currentChunk = sentence;
            }
        }

        // Add the last chunk
        if (currentChunk.trim().length > 0) {
            chunks.push({
                content: currentChunk.trim(),
                length: currentChunk.trim().length,
                index: chunks.length
            });
        }

        logger.info(`Created ${chunks.length} semantic chunks`);
        return chunks;
    }
}

// Export singleton instance
module.exports = new Chunker();