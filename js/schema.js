// Database schema v1, from design document 2 (DS-0.1). One Google Sheet, one tab per entity.
// Columns are always found by header name (never position). Missing columns are added at the end.

export const SCHEMA_VERSION = 1;
export const WORKBOOK_NAME = 'SCALE_GARAGE_MASTER';

const common = (idCol) => [idCol, 'created_at', 'updated_at', 'version', 'deleted_at', 'device_id'];

export const TABS = {
  COMPANIES: { entity: 'companies', id: 'company_id', cols: ['name', 'roles', 'parent_company_id', 'country', 'website', 'logo_photo_id', 'notes', 'record_status'] },
  BRANDS: { entity: 'brands', id: 'brand_id', cols: ['company_id', 'name', 'brand_kind', 'is_code_namespace', 'code_pattern_hint', 'code_example', 'record_status'] },
  PRODUCT_LINES: { entity: 'product_lines', id: 'line_id', cols: ['brand_id', 'name', 'is_code_namespace', 'code_prefix_hint', 'code_notes', 'record_status'] },
  ALIASES: { entity: 'aliases', id: 'alias_id', cols: ['alias_text', 'alias_cmp', 'target_type', 'target_id', 'source', 'evidence_photo_id'] },
  SCALES: { entity: 'scales', id: 'scale_id', cols: ['label', 'ratio_denominator', 'sort_order', 'active'] },
  CATEGORIES: { entity: 'categories', id: 'category_id', cols: ['name', 'parent_id', 'sort_order', 'active'] },
  OBJECTS: { entity: 'objects', id: 'object_id', cols: ['category_id', 'object_brand_id', 'object_name', 'object_year_text', 'notes'] },
  MODELS: { entity: 'models', id: 'model_id', cols: ['object_id', 'brand_id', 'line_id', 'printed_brand_text', 'printed_maker_text', 'printed_line_text', 'code_namespace_type', 'code_namespace_id', 'namespace_status', 'product_code', 'product_code_cmp', 'display_name', 'scale_id', 'category_id', 'variant', 'series', 'material', 'release_year', 'identification_status', 'completeness_status', 'duplicate_check_status', 'primary_photo_id', 'notes', 'colour_family', 'colour_name', 'car_note', 'car_note_source', 'barcode_absent'] },
  PRODUCT_IDENTIFIERS: { entity: 'product_identifiers', id: 'identifier_id', cols: ['model_id', 'identifier_type', 'value_raw', 'value_cmp', 'barcode_format', 'check_digit_ok', 'source', 'evidence_photo_id'] },
  INVENTORY: { entity: 'inventory', id: 'inventory_id', cols: ['model_id', 'ownership_status', 'condition', 'packaging_condition', 'packaging_state', 'storage_location', 'acquisition_type', 'purchase_date', 'purchase_date_precision', 'purchase_price', 'currency', 'purchase_source', 'order_id', 'acquisition_costs', 'mrp_reference_amount', 'mrp_reference_currency', 'mfg_month_text', 'import_month_text', 'importer_text', 'notes'] },
  ORDERS: { entity: 'orders', id: 'order_id', cols: ['vendor', 'order_date', 'currency', 'shipping_total', 'fees_total', 'notes'] },
  TRANSACTIONS: { entity: 'transactions', id: 'transaction_id', cols: ['inventory_id', 'transaction_type', 'transaction_date', 'amount', 'currency', 'fees', 'fx_rate', 'fx_source', 'fx_date', 'expense_category', 'counterparty', 'trade_group_id', 'reason', 'notes'] },
  PHOTOS: { entity: 'photos', id: 'photo_id', cols: ['model_id', 'inventory_id', 'wishlist_id', 'shot_role', 'photo_type', 'original_file_id', 'original_bytes', 'original_md5', 'width', 'height', 'exif_orientation', 'original_has_location', 'display_file_id', 'thumb_file_id', 'cropped_file_id', 'crop_corners', 'is_primary', 'source', 'original_filename', 'captured_at', 'uploaded_at', 'ai_processed'] },
  WISHLIST: { entity: 'wishlist', id: 'wishlist_id', cols: ['object_name', 'brand_id', 'printed_brand_text', 'product_code', 'scale_id', 'reference_photo_id', 'target_price', 'target_currency', 'priority', 'purchase_url', 'matching_model_id', 'status', 'notes'] },
  PRICE_EVIDENCE: { entity: 'price_evidence', id: 'evidence_id', cols: ['model_id', 'evidence_type', 'source_name', 'url', 'observed_date', 'price', 'currency', 'region', 'condition_text', 'condition_mapped', 'listing_type', 'match_confirmed', 'fx_rate', 'fx_source', 'fx_date', 'notes'] },
  VALUE_HISTORY: { entity: 'value_history', id: 'valuation_id', cols: ['run_id', 'inventory_id', 'model_id', 'status', 'estimated_value', 'currency', 'evidence_ids', 'evidence_count', 'confidence', 'method_note', 'valued_at'] },
  VALUATION_RUNS: { entity: 'valuation_runs', id: 'run_id', cols: ['scope', 'status', 'started_at', 'finished_at', 'items_total', 'items_done', 'owned_copies', 'valued_copies', 'coverage_pct', 'total_estimated_value', 'currency'] },
  STORAGE_BOXES: { entity: 'storage_boxes', id: 'storage_box_id', cols: ['box_label', 'box_name', 'notes', 'box_size', 'box_brand', 'box_scale'] },
  AI_LOG: { entity: 'ai_log', id: 'ai_log_id', cols: ['capture_session_id', 'model_id', 'ai_tool', 'prompt_version', 'input_photo_ids', 'ai_response_raw', 'suggested_values', 'confidence_data', 'confirmed_values', 'processed_at'] },
  CHANGE_LOG: { entity: 'change_log', id: 'change_id', cols: ['entity', 'record_id', 'field', 'old_value', 'new_value', 'reason', 'evidence_ref', 'changed_at'] },
};

// SETTINGS is a key/value tab without the common columns (brief §4).
export const SETTINGS_TAB = { name: 'SETTINGS', cols: ['configuration_key', 'configuration_value', 'updated_at'] };

export const headersFor = (tabName) => {
  const t = TABS[tabName];
  return [...common(t.id), ...t.cols];
};

export const tabOfEntity = (entity) => Object.keys(TABS).find(k => TABS[k].entity === entity);
export const idColOfEntity = (entity) => TABS[tabOfEntity(entity)].id;

// Entities the Stage 1 app keeps a local copy of and syncs.
export const SYNCED_ENTITIES = ['brands', 'product_lines', 'scales', 'categories', 'models', 'product_identifiers', 'inventory', 'photos', 'change_log', 'ai_log', 'storage_boxes', 'aliases'];

// Drive folder layout (brief §14; D24 drops 07_SOURCE_CODE).
export const FOLDERS = ['00_DATABASE', '01_MODEL_IMAGES', '02_PACKAGING', '03_PRODUCT_LABELS', '04_WISHLIST', '05_EXPORTS', '06_BACKUPS', '08_DOCUMENTATION'];
export const BACKUP_SUBFOLDERS = ['DAILY', 'MONTHLY', 'MANUAL'];
export const ROOT_FOLDER = 'SCALE GARAGE';

// Photo shot roles (D20) → brief photo_type and Drive folder.
export const SHOT_ROLES = {
  box_front: { label: 'Box front', type: 'Packaging', folder: '02_PACKAGING' },
  box_rear: { label: 'Box rear', type: 'Packaging', folder: '02_PACKAGING' },
  box_art: { label: 'Box art (sealed box)', type: 'Packaging', folder: '02_PACKAGING' },
  box_side: { label: 'Box side / end flap', type: 'Packaging', folder: '02_PACKAGING' },
  label: { label: 'Code label', type: 'Label', folder: '03_PRODUCT_LABELS' },
  car_front34: { label: 'Car front ¾', type: 'Model', folder: '01_MODEL_IMAGES' },
  car_rear34: { label: 'Car rear ¾', type: 'Model', folder: '01_MODEL_IMAGES' },
  car_side: { label: 'Side profile', type: 'Model', folder: '01_MODEL_IMAGES' },
  base: { label: 'Base (date code)', type: 'Underside', folder: '01_MODEL_IMAGES' },
  detail: { label: 'Detail / damage', type: 'Model', folder: '01_MODEL_IMAGES' },
  other: { label: 'Other', type: 'Other', folder: '01_MODEL_IMAGES' },
};

export const CONDITIONS = ['Mint', 'Excellent', 'Good', 'Fair', 'Damaged', 'Restoration Required'];
export const OWNERSHIP = ['Owned', 'Sold', 'Gifted', 'Traded', 'Missing'];

// ---------- Seed data (written once, at setup) ----------
export const SEED_SCALES = ['1:64', '1:43', '1:18', '1:12', '1:24', '1:32', '1:50', '1:72', '1:76', '1:87', '1:100', '1:144', '1:200', '1:6', '1:8', 'HO', 'Custom', 'Approximate', 'Unknown'];
export const SEED_CATEGORIES = ['Cars', 'Motorcycles', 'Trucks', 'Buses', 'Aircraft', 'Trains', 'Ships', 'Architecture', 'Figurines', 'Action Figures', 'Machinery', 'Military Models', 'Other Miniatures'];

// Brands B listed on 23 Nov (confirmed names). Code examples are from B's own boxes where seen;
// owner companies are not seeded (reference list still a draft).
export const SEED_BRANDS = [
  { name: 'Hot Wheels', code_pattern_hint: '5 characters, e.g. HYW58', code_example: 'HYW58' },
  { name: 'Mini GT', code_pattern_hint: 'MGT + 5 digits, optional -L / -R', code_example: 'MGT01311-L' },
  { name: 'Tarmac Works', code_pattern_hint: 'T64- / T64G- / T64R- / T64S- …', code_example: 'T64G-TL017-SL' },
  { name: 'Pop Race', code_pattern_hint: 'PR64- + number', code_example: 'PR64-0161' },
  { name: 'Inno64', code_pattern_hint: 'IN64- + model + variant', code_example: '' },
  { name: 'Tomica', code_pattern_hint: '', code_example: '' },
  { name: 'Bburago', code_pattern_hint: 'e.g. #18-38322', code_example: '#18-38322' },
  { name: 'BBR', code_pattern_hint: '', code_example: '' },
  { name: 'KK', code_pattern_hint: '', code_example: '' },
  { name: 'Solido', code_pattern_hint: '', code_example: '' },
  { name: 'AUTOart', code_pattern_hint: '', code_example: '' },
  { name: 'LCD', code_pattern_hint: '', code_example: '' },
  { name: 'GCD', code_pattern_hint: '', code_example: '' },
];
// Product lines: Kaido House is a Mini GT line (D21, confirmed). Others from research → needs review.
export const SEED_LINES = [
  { brand: 'Mini GT', name: 'Kaido House', code_prefix_hint: 'KHMG', record_status: 'confirmed' },
  { brand: 'Tarmac Works', name: 'Hobby64', code_prefix_hint: 'T64-', record_status: 'needs_review' },
  { brand: 'Tarmac Works', name: 'Global64', code_prefix_hint: 'T64G-', record_status: 'needs_review' },
  { brand: 'Tarmac Works', name: 'Road64', code_prefix_hint: 'T64R-', record_status: 'needs_review' },
  { brand: 'Hot Wheels', name: 'Silver Series', code_prefix_hint: '', record_status: 'needs_review' },
];
