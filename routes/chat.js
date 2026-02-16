// routes/chat.js
const express = require('express');
const router = express.Router();
const chatService = require('../services/chatService');
const logger = require('../utils/logger');

// Query endpoint
router.post('/query', async (req, res) => {
    try {
        const { query, documentId, options } = req.body;
        const userId = req.user?.id; // Will replace with real auth

        if (!query || query.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Query is required'
            });
        }

        logger.info(`Chat query from user ${userId}: ${query.substring(0, 50)}...`);

        const result = await chatService.processQuery(query, userId, {
            documentId,
            ...options
        });

        res.status(result.success ? 200 : 500).json(result);

    } catch (error) {
        logger.error('Chat query error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Query processing failed'
        });
    }
});

// Conversation endpoint
router.post('/conversation', async (req, res) => {
    try {
        const { messages, options } = req.body;
        const userId = req.user?.id;

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Messages array is required'
            });
        }

        logger.info(`Conversation request from user ${userId} (${messages.length} messages)`);

        const result = await chatService.processConversation(messages, userId, options);

        res.status(result.success ? 200 : 500).json(result);

    } catch (error) {
        logger.error('Conversation error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Conversation processing failed'
        });
    }
});

// routes/chat.js - ADD THIS ENDPOINT

// Get chat history
router.get('/history', async (req, res) => {
    try {
        const { documentId, sessionId, limit = 50 } = req.query;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        logger.info(`Getting chat history for user ${userId}, document: ${documentId || 'global'}`);

        // Use the supabase from your supabaseService
        const supabaseService = require('../services/supabaseService');
        const supabase = supabaseService.supabase;

        let query = supabase
            .from('chat_messages')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: true });

        // Handle documentId filter
        if (documentId) {
            if (documentId === 'null') {
                query = query.is('document_id', null); // Global chat
            } else {
                query = query.eq('document_id', documentId); // Document chat
            }
        }

        // Handle sessionId filter
        if (sessionId) {
            query = query.eq('session_id', sessionId);
        }

        // Apply limit
        if (limit) {
            query = query.limit(parseInt(limit));
        }

        const { data: messages, error } = await query;

        if (error) {
            logger.error('Database query error:', error);
            throw error;
        }

        res.json({
            success: true,
            data: messages || []
        });

    } catch (error) {
        logger.error('Chat history endpoint error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get chat history'
        });
    }
});
// routes/chat.js - ADD THIS TOO

// Clear chat history
router.delete('/clear', async (req, res) => {
    try {
        const { documentId, sessionId } = req.body;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        logger.info(`Clearing chat for user ${userId}, document: ${documentId || 'all'}`);

        const supabaseService = require('../services/supabaseService');
        const supabase = supabaseService.supabase;

        let query = supabase
            .from('chat_messages')
            .delete()
            .eq('user_id', userId);

        // Handle documentId filter
        if (documentId !== undefined) {
            if (documentId === null || documentId === 'null') {
                query = query.is('document_id', null); // Clear global chat
            } else {
                query = query.eq('document_id', documentId); // Clear document chat
            }
        }

        // Handle sessionId filter
        if (sessionId) {
            query = query.eq('session_id', sessionId);
        }

        const { error } = await query;

        if (error) {
            logger.error('Database delete error:', error);
            throw error;
        }

        res.json({
            success: true,
            message: documentId ? 'Document chat cleared' : 'Chat history cleared'
        });

    } catch (error) {
        logger.error('Clear chat endpoint error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to clear chat'
        });
    }
});
// Search endpoint (just retrieval, no answer generation)
router.post('/search', async (req, res) => {
    try {
        const { query, documentId, options } = req.body;
        const userId = req.user?.id;

        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'Query is required'
            });
        }

        logger.info(`Search request: ${query.substring(0, 50)}...`);

        const result = await chatService.searchDocuments(query, userId, {
            documentId,
            ...options
        });

        res.status(result.success ? 200 : 500).json(result);

    } catch (error) {
        logger.error('Search error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Search failed'
        });
    }
});

// Get suggested questions for a document
router.get('/suggestions/:documentId', async (req, res) => {
    try {
        const { documentId } = req.params;
        const { count = 5 } = req.query;
        const userId = req.user?.id;

        if (!documentId) {
            return res.status(400).json({
                success: false,
                error: 'Document ID is required'
            });
        }

        logger.info(`Getting suggestions for document ${documentId}`);

        const result = await chatService.getSuggestedQuestions(documentId, userId, parseInt(count));

        res.status(result.success ? 200 : 500).json(result);

    } catch (error) {
        logger.error('Suggestions error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get suggestions'
        });
    }
});

// Health check
router.get('/health', async (req, res) => {
    try {
        const health = await chatService.healthCheck();
        res.status(health.healthy ? 200 : 503).json(health);
    } catch (error) {
        res.status(500).json({
            healthy: false,
            error: error.message
        });
    }
});

module.exports = router;