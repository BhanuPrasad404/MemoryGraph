
// utils/fileParsers/constants.js
module.exports = {
    // Supported file types
    FILE_TYPES: {
        PDF: '.pdf',
        DOCX: '.docx',
        DOC: '.doc',
        TXT: '.txt',
        MD: '.md',
        JSON: '.json',
        CSV: '.csv',
        XLSX: '.xlsx',
        XLS: '.xls',
        PNG: '.png',
        JPG: '.jpg',
        JPEG: '.jpeg',
        GIF: '.gif',
        BMP: '.bmp',
        MP3: '.mp3',
        WAV: '.wav',
        MP4: '.mp4'
    },

    // MIME types mapping
    MIME_TYPES: {
        'application/pdf': 'pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/msword': 'doc',
        'text/plain': 'txt',
        'text/markdown': 'md',
        'application/json': 'json',
        'text/csv': 'csv',
        'application/vnd.ms-excel': 'xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/gif': 'gif',
        'image/bmp': 'bmp',
        'audio/mpeg': 'mp3',
        'audio/wav': 'wav',
        'video/mp4': 'mp4'
    },

    // Max file sizes (in bytes)
    MAX_FILE_SIZES: {
        pdf: 50 * 1024 * 1024,     // 50MB
        docx: 20 * 1024 * 1024,    // 20MB
        txt: 10 * 1024 * 1024,     // 10MB
        image: 5 * 1024 * 1024,    // 5MB
        audio: 100 * 1024 * 1024,  // 100MB
        video: 500 * 1024 * 1024   // 500MB
    },

    // Text extraction settings
    EXTRACTION_SETTINGS: {
        defaultEncoding: 'utf-8',
        maxTextLength: 10 * 1024 * 1024, // 10MB max text
        minTextLength: 10 // Minimum text to consider valid
    }
};