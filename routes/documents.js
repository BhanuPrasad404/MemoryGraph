// routes/documents.js - DOCUMENT MANAGEMENT WITH VALIDATION MIDDLEWARE
const express = require('express');
const router = express.Router();
const supabaseService = require('../services/supabaseService');
const documentProcessor = require('../services/documentProcessor');
const logger = require('../utils/logger');

const validateDocument = require('../middleware/validateDocument');
const validateDocumentQuery = require('../middleware/validateQuery');

// GET all documents for user with query validation
router.get('/', validateDocumentQuery.validateDocumentQuery, async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'UNAUTHORIZED'
      });
    }

    const { limit = 20, offset = 0, status, search, sort = 'created_at', order = 'desc' } = req.validatedQuery;

    // Get documents using your existing method
    // Destructure the returned object
    const { documents, total } = await supabaseService.getUserDocuments({
      userId,
      limit,
      offset,
      status,
      search,
      sort,
      order
    });

    res.json({
      success: true,
      data: documents.map(doc => ({
        id: doc.id,
        filename: doc.filename,
        file_url: doc.file_url,
        status: doc.status,
        file_size: doc.file_size,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
        num_chunks: doc.num_chunks || 0,
        num_nodes: doc.num_nodes || 0,
        num_edges: doc.num_edges || 0
      })),
      meta: {
        total, // use destructured total
        offset,
        hasMore: offset + documents.length < total
      }
    });

  } catch (error) {
    logger.error('Get documents error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch documents',
      code: 'FETCH_ERROR'
    });
  }
});
// GET specific document with ID validation
router.get('/:id', validateDocument.validateDocumentId, async (req, res) => {
  try {
    const documentId = req.documentId;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'UNAUTHORIZED'
      });
    }

    const document = await supabaseService.getDocument(documentId);

    if (!document || document.user_id !== userId) {
      return res.status(404).json({
        success: false,
        error: 'Document not found or access denied',
        code: 'DOCUMENT_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      data: document
    });
  } catch (error) {
    logger.error('Get document error:', error);

    if (error.message?.includes('not found') || error.message?.includes('no rows')) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
        code: 'DOCUMENT_NOT_FOUND'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to fetch document',
      code: 'FETCH_ERROR'
    });
  }
});

// DELETE document with ID validation
router.delete('/:id', validateDocument.validateDocumentId, async (req, res) => {
  try {
    const documentId = req.documentId;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'UNAUTHORIZED'
      });
    }

    const result = await documentProcessor.deleteDocument(documentId, userId);

    res.json({
      success: true,
      message: 'Document deleted successfully',
      data: result
    });
  } catch (error) {
    logger.error('Delete document error:', error);

    if (error.message.includes('not found') || error.message.includes('access denied')) {
      return res.status(404).json({
        success: false,
        error: error.message,
        code: 'DOCUMENT_NOT_FOUND'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to delete document',
      code: 'DELETE_ERROR'
    });
  }
});

// UPDATE document with validation middleware
router.put('/:id', validateDocument.validateDocumentId, validateDocument.validateDocumentFilename, async (req, res) => {
  try {
    const documentId = req.documentId;
    const userId = req.user?.id;
    const updates = {
      filename: req.filename
    };


    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'UNAUTHORIZED'
      });
    }

    // Verify document belongs to user
    const document = await supabaseService.getDocument(documentId);
    if (!document || document.user_id !== userId) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
        code: 'DOCUMENT_NOT_FOUND'
      });
    }

    // Update document with validated data
    const updated = await supabaseService.updateDocument(documentId, updates);

    res.json({
      success: true,
      message: 'Document updated successfully',
      data: updated
    });
  } catch (error) {
    logger.error('Update document error:', error);

    if (error.message?.includes('not found') || error.message?.includes('no rows')) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
        code: 'DOCUMENT_NOT_FOUND'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to update document',
      code: 'UPDATE_ERROR'
    });
  }
});

// EXPORT document with validation middleware
router.get('/:id/export', validateDocument.validateDocumentId, validateDocument.validateExportFormat, async (req, res) => {
  try {
    const documentId = req.documentId;
    const userId = req.user?.id;
    const format = req.exportFormat;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'UNAUTHORIZED'
      });
    }

    // Verify document belongs to user
    const document = await supabaseService.getDocument(documentId);
    if (!document || document.user_id !== userId) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
        code: 'DOCUMENT_NOT_FOUND'
      });
    }

    // Get chunks
    const chunks = await supabaseService.getDocumentChunks(documentId);

    let exportData;
    let contentType = 'application/json';
    let filename = `document-${documentId}-${Date.now()}`;

    if (format === 'text') {
      exportData = chunks.map(c => c.content).join('\n\n---\n\n');
      contentType = 'text/plain';
      filename += '.txt';
    } else if (format === 'json') {
      exportData = JSON.stringify({
        metadata: {
          id: document.id,
          filename: document.filename,
          status: document.status,
          created_at: document.created_at,
          updated_at: document.updated_at,
          num_chunks: chunks.length
        },
        chunks: chunks.map(c => ({
          index: c.chunk_index,
          content: c.content,
          content_preview: c.content.substring(0, 200) + '...',
          length: c.content?.length || 0
        }))
      }, null, 2);
      filename += '.json';
    } else if (format === 'csv') {
      // Simple CSV format
      const headers = ['chunk_index', 'content_preview', 'length'];
      const rows = chunks.map(c => [
        c.chunk_index,
        `"${c.content.substring(0, 100).replace(/"/g, '""')}..."`,
        c.content?.length || 0
      ]);
      exportData = [headers, ...rows].map(row => row.join(',')).join('\n');
      contentType = 'text/csv';
      filename += '.csv';
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(exportData);

  } catch (error) {
    logger.error('Export error:', error);

    if (error.message?.includes('not found') || error.message?.includes('no rows')) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
        code: 'DOCUMENT_NOT_FOUND'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to export document',
      code: 'EXPORT_ERROR'
    });
  }
});

// GET document chunks
router.get('/:id/chunks', validateDocument.validateDocumentId, async (req, res) => {
  try {
    const documentId = req.documentId;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'UNAUTHORIZED'
      });
    }

    // Verify document belongs to user
    const document = await supabaseService.getDocument(documentId);
    if (!document || document.user_id !== userId) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
        code: 'DOCUMENT_NOT_FOUND'
      });
    }

    const chunks = await supabaseService.getDocumentChunks(documentId);

    res.json({
      success: true,
      data: {
        document_id: documentId,
        total_chunks: chunks.length,
        chunks: chunks.map(c => ({
          id: c.id,
          chunk_index: c.chunk_index,
          content_preview: c.content?.substring(0, 200) + '...',
          content_length: c.content?.length || 0,
          vector_id: c.vector_id
        }))
      }
    });
  } catch (error) {
    logger.error('Get chunks error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chunks',
      code: 'FETCH_CHUNKS_ERROR'
    });
  }
});

// GET document graph data
router.get('/:id/graph', validateDocument.validateDocumentId, async (req, res) => {
  try {
    const documentId = req.documentId;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'UNAUTHORIZED'
      });
    }

    // Verify document belongs to user
    const document = await supabaseService.getDocument(documentId);
    if (!document || document.user_id !== userId) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
        code: 'DOCUMENT_NOT_FOUND'
      });
    }

    const graphData = await supabaseService.getDocumentGraph(documentId);

    res.json({
      success: true,
      data: {
        document_id: documentId,
        total_nodes: graphData.nodes?.length || 0,
        total_edges: graphData.edges?.length || 0,
        nodes: graphData.nodes,
        edges: graphData.edges
      }
    });
  } catch (error) {
    logger.error('Get graph error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch graph data',
      code: 'FETCH_GRAPH_ERROR'
    });
  }
});

module.exports = router;