// utils/fileParser/cleanText.js
const logger = require('../logger');

class TextCleaner {
    constructor() {
        logger.info('TextCleaner initialized with OCR enhancement');
    }

    /**
     * MAIN CLEANING FUNCTION - ENHANCED WITH OCR FIXES
     */
    clean(text, options = {}) {
        try {
            if (!text || typeof text !== 'string') {
                return '';
            }

            let cleaned = text;

            // ===== PHASE 1: BASIC CLEANUP =====
            cleaned = this.removeNullCharacters(cleaned);
            cleaned = this.normalizeWhitespace(cleaned);
            cleaned = this.cleanPageHeadersFooters(cleaned);

            // ===== PHASE 2: OCR-SPECIFIC FIXES =====
            if (options.fixOCR || this.detectOcrIssues(cleaned)) {
                cleaned = this.fixOcrSpacing(cleaned);      // Fix "s p a c e d o u t"
                cleaned = this.fixOcrCharacters(cleaned);   // Fix 0→O, 1→I, etc.
                cleaned = this.fixOcrWords(cleaned);        // Fix "dassroom" → "classroom"
                cleaned = this.fixOcrFormatting(cleaned);   // Fix emails, phones, dates
            }

            // ===== PHASE 3: OPTIONAL CLEANING =====
            if (options.removeUrls) {
                cleaned = this.removeUrls(cleaned);
            }

            if (options.removeEmails) {
                cleaned = this.removeEmails(cleaned);
            }

            if (options.removeSpecialChars) {
                cleaned = this.removeSpecialCharacters(cleaned);
            }

            // ===== PHASE 4: FINAL NORMALIZATION =====
            cleaned = this.ensureSentenceEndings(cleaned);
            cleaned = this.removeDuplicateLines(cleaned);
            cleaned = this.finalCleanup(cleaned);

            logger.debug(`Text cleaned: ${text.length} → ${cleaned.length} characters`);

            return cleaned;

        } catch (error) {
            logger.error('Text cleaning error:', error);
            return text || '';
        }
    }

    /**
     * ===== CORE OCR FIXING METHODS =====
     */

    /**
     * DETECT OCR ISSUES
     */
    detectOcrIssues(text) {
        if (!text || text.length < 50) return false;

        // Check for spaced-out text pattern
        const sample = text.substring(0, 500);
        const spaces = (sample.match(/\s/g) || []).length;
        const chars = sample.replace(/\s/g, '').length;

        // If more than 40% spaces, likely OCR spacing issue
        if (spaces > chars * 0.4) return true;

        // Check for common OCR errors
        const ocrPatterns = [
            /[0O5]\s*[A-Za-z]/g,      // 0 or O or 5 followed by letter
            /[Il1]\s*[a-z]/g,         // I, l, or 1 followed by lowercase
            /dassroom|fl.om|tecknology/gi // Common OCR word errors
        ];

        return ocrPatterns.some(pattern => pattern.test(text));
    }

    /**
     * FIX OCR SPACING (CRITICAL - FIXES YOUR "F----, : , . . ," ISSUE)
     */
    fixOcrSpacing(text) {
        let cleaned = text;

        // Step 1: Remove junk patterns at start (like "F----, : , . . ,")
        cleaned = cleaned.replace(/^[^A-Za-z0-9\s]{5,}/, '');
        cleaned = cleaned.replace(/^[^A-Za-z0-9]+/, '');

        // Step 2: Check if text is "space between every character"
        const nonSpaceChars = cleaned.replace(/\s/g, '').length;
        const spaceCount = (cleaned.match(/\s/g) || []).length;

        if (spaceCount > nonSpaceChars * 0.6 && nonSpaceChars > 20) {
            // Remove ALL spaces and reconstruct words
            const noSpaces = cleaned.replace(/\s+/g, '');

            // SMART WORD RECONSTRUCTION:
            let reconstructed = noSpaces;

            // Rule 1: Sentence boundaries
            reconstructed = reconstructed.replace(/([.!?])([A-Z])/g, '$1 $2');

            // Rule 2: CamelCase boundaries
            reconstructed = reconstructed.replace(/([a-z])([A-Z])/g, '$1 $2');

            // Rule 3: Number boundaries
            reconstructed = reconstructed.replace(/(\d)([A-Za-z])/g, '$1 $2');
            reconstructed = reconstructed.replace(/([A-Za-z])(\d)/g, '$1 $2');

            // Rule 4: Common word endings
            const wordEndings = ['ing', 'ed', 'ly', 'tion', 'ment', 'ness', 'ity', 'al'];
            wordEndings.forEach(ending => {
                const regex = new RegExp(`([a-zA-Z])(${ending})([A-Z])`, 'gi');
                reconstructed = reconstructed.replace(regex, '$1$2 $3');
            });

            cleaned = reconstructed;
        }

        // Step 3: Fix random punctuation clusters
        cleaned = cleaned.replace(/[.,!?;:]{2,}/g, match => match[0]);

        return cleaned;
    }

    /**
     * FIX OCR CHARACTER ERRORS
     */
    fixOcrCharacters(text) {
        const charReplacements = [
            // Number → Letter confusions (in text context)
            [/0(?=[A-Za-z])/g, 'O'],      // 0 → O before letters
            [/0(?![0-9])/g, 'O'],         // 0 → O when not part of number
            [/5(?=[A-Za-z])/g, 'S'],      // 5 → S before letters
            [/1(?![0-9])/g, 'I'],         // 1 → I when not part of number

            // Letter → Number confusions (in number context)
            [/O(?=\d)/g, '0'],           // O → 0 before numbers
            [/S(?=\d)/g, '5'],           // S → 5 before numbers
            [/I(?=\d)/g, '1'],           // I → 1 before numbers
            [/l(?=\d)/g, '1'],           // l → 1 before numbers

            // Common OCR character errors
            [/\|/g, 'I'],                // | → I
            [/@/g, 'a'],                 // @ → a
            [/\[rn\]/g, 'm'],            // [rn] → m
            [/cl/g, 'd'],                // cl → d
            [/vv/g, 'w'],                // vv → w

            // Fix specific patterns from your examples
            [/fIom/gi, 'from'],          // fIom → from
            [/fl-om/gi, 'from'],         // fl-om → from
            [/£/g, 'E'],                 // £ → E
        ];

        let fixed = text;
        charReplacements.forEach(([pattern, replacement]) => {
            fixed = fixed.replace(pattern, replacement);
        });

        return fixed;
    }

    /**
     * FIX OCR WORD ERRORS
     */
    fixOcrWords(text) {
        const wordReplacements = [
            ['dassroom', 'classroom'],
            ['tecknology', 'technology'],
            ['technoIogy', 'technology'],
            ['univer5ity', 'university'],
            ['5tudent', 'student'],
            ['re5earch', 'research'],
            ['5kills', 'skills'],
            ['experi5e', 'expertise'],
            ['5uccess', 'success'],
            ['5ystem', 'system'],

            // Fix your specific examples
            ['Etitive', 'competitive'],
            ['dassroom', 'classroom'],
            ['Jaalial', 'Jagtial'],
            ['Jpail', 'Jagtial'],
            ['Engin.;;.,;no', 'Engineering'],
            ['MIST£', 'MISTE'],
            ['Ac. In', 'ac.in'],
            ['jntuh. Ac. In', 'jntuh.ac.in'],

            // Academic/common terms
            ['B.Tech', 'B.Tech'],
            ['M.Tech', 'M.Tech'],
            ['Ph.D.', 'Ph.D.'],
            ['Dr.', 'Dr.'],
            ['Prof.', 'Prof.'],
            ['Mr.', 'Mr.'],
            ['Ms.', 'Ms.'],
            ['Mrs.', 'Mrs.'],
        ];

        let fixed = text;
        wordReplacements.forEach(([bad, good]) => {
            const regex = new RegExp(`\\b${bad}\\b`, 'gi');
            fixed = fixed.replace(regex, good);
        });

        return fixed;
    }

    /**
     * FIX OCR FORMATTING (emails, phones, dates)
     */
    fixOcrFormatting(text) {
        let fixed = text;

        // Fix emails (remove spaces in emails)
        fixed = fixed.replace(/(\w+)\s*@\s*(\w+)/g, '$1@$2');
        fixed = fixed.replace(/(\w+)\.\s*(com|org|edu|net|in|ac)/gi, '$1.$2');

        // Fix phone numbers
        fixed = fixed.replace(/(\d)\s+(\d)\s+(\d)\s+(\d)\s+(\d)\s+(\d)\s+(\d)\s+(\d)\s+(\d)\s+(\d)/g,
            '$1$2$3$4$5$6$7$8$9$10');
        fixed = fixed.replace(/\b(\d{10})\b/g, '+91 $1');
        fixed = fixed.replace(/\b91\s+(\d{10})\b/g, '+91 $1');

        // Fix dates
        fixed = fixed.replace(/(\d{4})\s*[-_]\s*(\d{2})\s*[-_]\s*(\d{2})/g, '$1-$2-$3');

        // Fix hyphenated words
        fixed = fixed.replace(/(\w)\s*-\s*(\w)/g, '$1$2'); // extra-curricular → extracurricular
        fixed = fixed.replace(/(\w)\s*'\s*(\w)/g, "$1'$2"); // subjects'Machine → subjects'Machine

        return fixed;
    }

    /**
     * ===== BASIC CLEANING METHODS (KEEP YOUR EXISTING) =====
     */

    removeNullCharacters(text) {
        return text
            .replace(/\0/g, '')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
            .replace(/[\u200B-\u200D\uFEFF]/g, '');
    }

    normalizeWhitespace(text) {
        return text
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/\t/g, '    ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n[ \t]+\n/g, '\n\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    cleanPageHeadersFooters(text) {
        // Remove page numbers (standalone numbers)
        let cleaned = text.replace(/^\s*\d+\s*$/gm, '');

        // Remove common header/footer patterns
        const patterns = [
            /^Page\s+\d+\s+of\s+\d+$/gmi,
            /^Confidential$/gmi,
            /^Draft$/gmi,
            /^©.*$/gmi,
            /^Copyright.*$/gmi,
            /^\d{1,2}\/\d{1,2}\/\d{4}$/gm, // Dates alone
        ];

        patterns.forEach(pattern => {
            cleaned = cleaned.replace(pattern, '');
        });

        return cleaned;
    }

    removeUrls(text) {
        return text.replace(/https?:\/\/[^\s]+/g, '');
    }

    removeEmails(text) {
        return text.replace(/\S+@\S+\.\S+/g, '');
    }

    removeSpecialCharacters(text) {
        // Keep: letters, numbers, basic punctuation, whitespace
        return text.replace(/[^\w\s.,!?;:'"()\[\]{}@#$%&*+-=<>\/\\|~`]/g, ' ');
    }

    ensureSentenceEndings(text) {
        if (!text || text.length === 0) return text;

        const lastChar = text[text.length - 1];
        if (!/[.!?]/.test(lastChar)) {
            return text + '.';
        }
        return text;
    }

    removeDuplicateLines(text) {
        const lines = text.split('\n');
        const uniqueLines = [];
        const seen = new Set();

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length < 10) {
                uniqueLines.push(line);
                continue;
            }

            const simple = trimmed.toLowerCase().replace(/\s+/g, ' ');
            if (!seen.has(simple)) {
                seen.add(simple);
                uniqueLines.push(line);
            }
        }

        return uniqueLines.join('\n');
    }

    finalCleanup(text) {
        return text
            .replace(/\s+/g, ' ')
            .replace(/^\s+|\s+$/g, '')
            .trim();
    }

    /**
     * ===== UTILITY METHODS (KEEP YOUR EXISTING) =====
     */

    splitParagraphs(text, minParagraphLength = 50) {
        const paragraphs = text.split(/\n\s*\n/);
        return paragraphs
            .map(p => p.trim())
            .filter(p => p.length >= minParagraphLength);
    }

    extractSentences(text) {
        return text.match(/[^.!?]+[.!?]+/g) || [text];
    }

    analyzeText(text) {
        const words = text.match(/\b\w+\b/g) || [];
        const sentences = this.extractSentences(text);
        const paragraphs = this.splitParagraphs(text, 0);

        const wordCount = words.length;
        const sentenceCount = sentences.length;
        const paragraphCount = paragraphs.length;

        const avgWordLength = wordCount > 0
            ? words.reduce((sum, word) => sum + word.length, 0) / wordCount
            : 0;

        const avgSentenceLength = sentenceCount > 0 ? wordCount / sentenceCount : 0;
        const avgParagraphLength = paragraphCount > 0 ? sentenceCount / paragraphCount : 0;

        return {
            wordCount,
            sentenceCount,
            paragraphCount,
            avgWordLength: Math.round(avgWordLength * 100) / 100,
            avgSentenceLength: Math.round(avgSentenceLength * 100) / 100,
            avgParagraphLength: Math.round(avgParagraphLength * 100) / 100,
            characterCount: text.length,
            nonWhitespaceCount: text.replace(/\s/g, '').length
        };
    }

    validateText(text, minLength = 10, maxLength = 10000000) {
        if (!text || typeof text !== 'string') {
            return { valid: false, error: 'Text is not a string' };
        }

        const trimmed = text.trim();
        const length = trimmed.length;

        if (length < minLength) {
            return { valid: false, error: `Text too short (${length} < ${minLength})` };
        }

        if (length > maxLength) {
            return { valid: false, error: `Text too long (${length} > ${maxLength})` };
        }

        const wordCount = (trimmed.match(/\b\w+\b/g) || []).length;
        if (wordCount < 3) {
            return { valid: false, error: 'Text contains too few words' };
        }

        return { valid: true, length, wordCount };
    }
}

module.exports = new TextCleaner();