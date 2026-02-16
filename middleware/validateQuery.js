// middleware/validateQuery.js - QUERY PARAMETER VALIDATION ONLY
const logger = require('../utils/logger');

/**
 * Validates query parameters for document listing
 */
const validateDocumentQuery = (req, res, next) => {
  const { 
    limit = '50', 
    offset = '0', 
    status, 
    sort_by = 'created_at',
    order = 'desc'
  } = req.query;
  
  const validatedQuery = {};
  
  // Validate limit (1-100)
  const limitNum = parseInt(limit, 10);
  if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
    return res.status(400).json({
      success: false,
      error: 'Limit must be between 1 and 100'
    });
  }
  validatedQuery.limit = limitNum;
  
  // Validate offset (>= 0)
  const offsetNum = parseInt(offset, 10);
  if (isNaN(offsetNum) || offsetNum < 0) {
    return res.status(400).json({
      success: false,
      error: 'Offset must be a non-negative number'
    });
  }
  validatedQuery.offset = offsetNum;
  
  // Validate status filter
  if (status) {
    const validStatuses = ['processing', 'completed', 'failed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }
    validatedQuery.status = status;
  }
  
  // Validate sort field
  const validSortFields = ['created_at', 'updated_at', 'filename', 'file_size'];
  if (!validSortFields.includes(sort_by)) {
    return res.status(400).json({
      success: false,
      error: `Invalid sort field. Use: ${validSortFields.join(', ')}`
    });
  }
  validatedQuery.sort_by = sort_by;
  
  // Validate order
  if (order !== 'asc' && order !== 'desc') {
    return res.status(400).json({
      success: false,
      error: 'Order must be "asc" or "desc"'
    });
  }
  validatedQuery.order = order;
  
  // Store validated query
  req.validatedQuery = validatedQuery;
  next();
};

/**
 * Validates search query parameter
 */
const validateSearchQuery = (req, res, next) => {
  const { search } = req.query;
  
  if (search) {
    if (typeof search !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Search must be a string'
      });
    }
    
    const trimmedSearch = search.trim();
    
    if (trimmedSearch.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Search query cannot be empty'
      });
    }
    
    if (trimmedSearch.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Search query too long (max 100 characters)'
      });
    }
    
    req.searchQuery = trimmedSearch;
  }
  
  next();
};

module.exports = {
  validateDocumentQuery,
  validateSearchQuery
};