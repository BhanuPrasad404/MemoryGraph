// routes/upload.js
const express = require('express');
const multer = require('multer');
const documentProcessor = require('../services/documentProcessor');
const validateFileUpload = require('../middleware/validateUpload');
const authMiddleware = require('../middleware/auth');
const supabaseService = require('../services/supabaseService');
const router = express.Router();

const logger = require('../utils/logger');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/', upload.single('file'), validateFileUpload, async (req, res) => {
  try {
    const userId = req.user?.id;
    const file = req.file;

    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    logger.info(`📤 Uploading: ${file.originalname} for user: ${userId}`);

    // 1. CREATE DOCUMENT RECORD FIRST (QUICK)
    const document = await supabaseService.createDocument({
      filename: file.originalname,
      user_id: userId,
      file_url: 'processing', // temporary
      status: 'processing',
      file_size: file.buffer.length
    });

    const documentId = document.id;

    // 2. RETURN IMMEDIATELY WITH DOCUMENT ID
    res.json({
      success: true,
      message: 'Document processing started',
      documentId: documentId,
      filename: file.originalname,
      webSocketRoom: `document-${documentId}`,
      status: 'processing',
      timestamp: new Date().toISOString()
    });

    // 3. PROCESS IN BACKGROUND (WITH DOCUMENT ID)
    setTimeout(async () => {
      try {
        logger.info(`🔧 Starting background processing for document ${documentId}`);

        const result = await documentProcessor.processDocument(
          file.buffer,
          file.originalname,
          userId,
          documentId  //  PASS DOCUMENT ID HERE
        );

        if (result && result.success) {
          logger.info(`✅ Processing completed for document ${documentId}`);

          // Optional: Final update if needed
          await supabaseService.updateDocument(documentId, {
            file_url: result.file_url || 'completed',
            num_chunks: result.num_chunks || 0,
            num_nodes: result.num_nodes || 0,
            num_edges: result.num_edges || 0,
            updated_at: new Date().toISOString()
          });
        } else {
          logger.error(`❌ Processing failed for document ${documentId}: ${result?.error || 'Unknown error'}`);
        }

      } catch (error) {
        logger.error(`❌ Processing failed for document ${documentId}:`, error);

        // Update document status to failed
        try {
          await supabaseService.updateDocument(documentId, {
            status: 'failed',
            error_message: error.message,
            updated_at: new Date().toISOString()
          });
        } catch (updateError) {
          logger.error('Failed to update document status:', updateError);
        }
      }
    }, 200);

  } catch (error) {
    logger.error('Upload error:', error);
    res.status(500).json({ success: false, error: 'Upload failed', details: error.message });
  }
});

module.exports = router;