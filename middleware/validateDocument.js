// middleware/validateDocument.js - DOCUMENT VALIDATION ONLY
const logger = require('../utils/logger');

/**
 * Validates document ID (UUID or numeric)
 */
const validateDocumentId = (req, res, next) => {
  const documentId = req.params.id || req.params.documentId;
  
  if (!documentId) {
    return res.status(400).json({
      success: false,
      error: 'Document ID is required'
    });
  }

  // Check if it's a UUID or numeric ID
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId);
  const isNumeric = /^\d+$/.test(documentId);
  
  if (!isUUID && !isNumeric) {
    return res.status(400).json({
      success: false,
      error: 'Invalid document ID format'
    });
  }

  req.documentId = documentId;
  next();
};

/**
 * Validates document filename for updates
 */
const validateDocumentFilename = (req, res, next) => {
  const { filename } = req.body;
  
  // Filename is required for rename operations
  if (req.method === 'PUT' || req.method === 'PATCH') {
    if (!filename) {
      return res.status(400).json({
        success: false,
        error: 'Filename is required for update'
      });
    }
  }

  // If filename is provided, validate it
  if (filename) {
    if (typeof filename !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Filename must be a string'
      });
    }
    
    const trimmedFilename = filename.trim();
    
    if (trimmedFilename.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Filename cannot be empty'
      });
    }
    
    if (trimmedFilename.length > 255) {
      return res.status(400).json({
        success: false,
        error: 'Filename too long (max 255 characters)'
      });
    }
    
    // Basic security: prevent path traversal
    if (trimmedFilename.includes('..') || trimmedFilename.includes('/') || trimmedFilename.includes('\\')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filename'
      });
    }
    
    req.filename = trimmedFilename;
  }
  
  next();
};

/**
 * Validates document export format
 */
const validateExportFormat = (req, res, next) => {
  const { format = 'json' } = req.query;
  
  const validFormats = ['json', 'text', 'csv'];
  
  if (!validFormats.includes(format.toLowerCase())) {
    return res.status(400).json({
      success: false,
      error: `Invalid format. Use: ${validFormats.join(', ')}`
    });
  }
  
  req.exportFormat = format.toLowerCase();
  next();
};

module.exports = {
  validateDocumentId,
  validateDocumentFilename,
  validateExportFormat
};