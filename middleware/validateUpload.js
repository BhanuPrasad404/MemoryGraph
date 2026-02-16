// middleware/validateUpload.js - CORRECTED (FILE ONLY)
const validateFileUpload = (req, res, next) => {
  try {
    // 1. File exists
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded'
      });
    }

    // 2. File size (50MB)
    if (req.file.size > 50 * 1024 * 1024) {
      return res.status(400).json({
        error: 'File too large (max 50MB)'
      });
    }

    // 3. File type
    const allowedTypes = ['application/pdf', 'text/plain', 'text/markdown', 'application/json'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        error: 'Unsupported file type. Use: PDF, TXT, MD, JSON'
      });
    }

    // 4. Not empty
    if (req.file.size === 0) {
      return res.status(400).json({
        error: 'File is empty'
      });
    }

    next();
    
  } catch (error) {
    console.error('Upload validation error:', error);
    res.status(500).json({
      error: 'Upload validation failed'
    });
  }
};

module.exports = validateFileUpload;
