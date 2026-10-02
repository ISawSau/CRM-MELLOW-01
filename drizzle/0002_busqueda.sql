-- Búsqueda global (SPEC §6). Índice FTS5 mantenido desde el proceso principal en
-- cada escritura. `remove_diacritics 2` hace que «campaña» y «campana» coincidan.
CREATE VIRTUAL TABLE `search_fts` USING fts5(
	`record_id` UNINDEXED,
	`entity` UNINDEXED,
	`title`,
	`body`,
	tokenize = 'unicode61 remove_diacritics 2'
);
