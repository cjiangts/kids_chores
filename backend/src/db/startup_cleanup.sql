-- Cleanup legacy printable writing-sheet storage after migration to type2_chinese_print_sheets.
DROP TABLE IF EXISTS writing_sheet_cards;
DROP TABLE IF EXISTS writing_sheets;
DROP SEQUENCE IF EXISTS writing_sheets_id_seq;
