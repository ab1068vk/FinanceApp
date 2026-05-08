function pagination(req, defaultPageSize = 50, maxPageSize = 200) {
  const page = Math.max(Number.parseInt(String(req.query.page || '1'), 10) || 1, 1);
  const rawPageSize = Number.parseInt(String(req.query.limit || req.query.page_size || defaultPageSize), 10);
  const pageSize = Math.min(Math.max(Number.isNaN(rawPageSize) ? defaultPageSize : rawPageSize, 1), maxPageSize);
  return {
    page,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
}

function paginationMeta(page, pageSize, total) {
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  return {
    total_count: total,
    page,
    page_size: pageSize,
    total_pages: totalPages,
    total,
    limit: pageSize,
    totalPages,
  };
}

module.exports = {
  pagination,
  paginationMeta,
};
