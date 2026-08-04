import type {
    IDataObject,
    IExecuteFunctions,
    IHttpRequestMethods,
    IHttpRequestOptions,
    ILoadOptionsFunctions,
    INode,
    INodeExecutionData,
    INodeParameters,
    INodeType,
    INodeTypeDescription,
} from 'n8n-workflow';
import {
    NodeConnectionTypes,
    NodeOperationError,
    randomString,
    sleep,
} from 'n8n-workflow';

const API = 'https://api.sallaflow.cloud';

interface RequestErrorLike {
    body?: unknown;
    cause?: {
        response?: {
            data?: unknown;
        };
    };
    description?: string;
    httpCode?: number;
    message?: string;
    response?: {
        body?: unknown;
        data?: unknown;
        status?: number;
    };
    statusCode?: number;
}

interface RequestContext {
    ctx?: string;
    itemIndex?: number;
    readContext?: string;
}

function asDataObject(value: unknown): IDataObject {
    return value as IDataObject;
}

function asNodeParameters(value: unknown): INodeParameters {
    return value as INodeParameters;
}

function asNodeParameterArray(value: unknown): INodeParameters[] {
    return value as INodeParameters[];
}

function asRequestError(value: unknown): RequestErrorLike {
    return value as RequestErrorLike;
}

// ── Helper: parse "1,2,3" into [1,2,3] or ["1","2","3"] ──
function csvToArray(val: unknown, asNumber = false): Array<string | number> {
    if (val === undefined || val === null || val === '')
        return [];
    const source = Array.isArray(val) ? val : String(val).split(',');
    return source
        .flatMap((entry) => String(entry).split(','))
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => asNumber ? Number(entry) : entry);
}
function parseJsonInput(
    raw: unknown,
    node: INode,
    itemIndex: number,
    label: string,
): unknown {
    if (typeof raw !== 'string')
        return raw;
    try {
        return JSON.parse(raw) as unknown;
    }
    catch {
        throw new NodeOperationError(node, `${label} is not valid JSON. If you are using an n8n expression, make sure it starts with "=".`, { itemIndex });
    }
}
function normalizeInventoryItems(
    raw: unknown,
    node: INode,
    itemIndex: number,
): IDataObject[] {
    const source = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object'
            ? asDataObject(raw).products
            : undefined;
    if (!Array.isArray(source) || source.length === 0)
        throw new NodeOperationError(node, 'Inventory update requires at least one product or variant entry.', { itemIndex });
    const allowedTypes = new Set(['id', 'sku', 'variant_id']);
    const allowedModes = new Set(['increment', 'decrement', 'overwrite']);
    return source.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
            throw new NodeOperationError(node, `Inventory entry ${index + 1} must be an object.`, { itemIndex });
        // Salla's public API intentionally documents these keys as "identifer_*".
        // Accept correctly-spelled aliases in Advanced JSON, but always emit the
        // upstream spelling so merchants do not have to remember the typo.
        const item = asDataObject(entry);
        const identiferType = item.identifer_type ?? item.identifier_type;
        const identifer = item.identifer ?? item.identifier;
        const mode = item.mode;
        const quantity = Number(item.quantity);
        if (!allowedTypes.has(String(identiferType || '')))
            throw new NodeOperationError(node, `Inventory entry ${index + 1}: identifier type must be id, sku, or variant_id.`, { itemIndex });
        if (identifer === undefined || identifer === null || String(identifer).trim() === '')
            throw new NodeOperationError(node, `Inventory entry ${index + 1}: identifier is required.`, { itemIndex });
        if (!Number.isFinite(quantity) || quantity < 0)
            throw new NodeOperationError(node, `Inventory entry ${index + 1}: quantity must be a number greater than or equal to 0.`, { itemIndex });
        if (!allowedModes.has(String(mode || '')))
            throw new NodeOperationError(node, `Inventory entry ${index + 1}: mode must be increment, decrement, or overwrite.`, { itemIndex });
        const normalized: IDataObject = {
            identifer_type: String(identiferType),
            identifer: String(identifer),
            quantity,
            mode: String(mode),
        };
        if (item.branch !== undefined && item.branch !== null && String(item.branch).trim() !== '')
            normalized.branch = item.branch;
        if (item.reason_id !== undefined && item.reason_id !== null && String(item.reason_id).trim() !== '')
            normalized.reason_id = item.reason_id;
        if (item.unlimited_quantity !== undefined && item.unlimited_quantity !== null && item.unlimited_quantity !== '')
            normalized.unlimited_quantity = item.unlimited_quantity === true || String(item.unlimited_quantity).toLowerCase() === 'true';
        return normalized;
    });
}
function formatFieldErrors(fields: unknown): string {
    return Object.entries((fields || {}) as Record<string, unknown>)
        .flatMap(([key, value]) => {
            const label = String(key)
                .replace(/[_\-.]+/g, ' ')
                .replace(/\b\w/g, (character) => character.toUpperCase());
            const messages = Array.isArray(value) ? value : [value];
            return messages
                .filter((message) => message !== undefined && message !== null && message !== '')
                .map((message) => `${label}: ${String(message)}`);
        })
        .join('; ');
}
function normalizeSallaError(
    requestError: unknown,
    retryStatuses: ReadonlySet<number> = new Set<number>(),
) {
    const reqErr = asRequestError(requestError);
    const body = reqErr.response?.data
        || reqErr.response?.body
        || reqErr.cause?.response?.data
        || reqErr.body;
    const status = reqErr.response?.status || reqErr.statusCode || reqErr.httpCode;
    let msg = reqErr.message || 'SallaFlow request failed';
    let fields: IDataObject = {};
    let code = '';
    if (body) {
        const parsedBody = typeof body === 'string'
            ? (() => { try { return JSON.parse(body) as unknown; } catch { return { raw: body }; } })()
            : body;
        const data = asDataObject(parsedBody);
        const nestedError = data.error;
        const nestedErrorObject = asDataObject(nestedError ?? {});
        code = String(data.code || (typeof nestedError === 'object' ? nestedErrorObject.code : '') || '');
        fields = asDataObject(
            data.fields
            || data.errors
            || (typeof nestedError === 'object'
                ? nestedErrorObject.fields || nestedErrorObject.errors
                : {})
            || {},
        );
        if (typeof nestedError === 'object' && nestedErrorObject.message)
            msg = String(nestedErrorObject.message);
        else if (typeof nestedError === 'string')
            msg = String(data.message || nestedError);
        else if (data.message)
            msg = String(data.message);
    }
    const fieldDetails = formatFieldErrors(fields);
    const genericMessage = !msg
        || /^alert\./i.test(msg)
        || /invalid[._ ]fields?/i.test(msg)
        || msg === 'Unprocessable Entity';
    if (fieldDetails) {
        msg = genericMessage
            ? `Please correct these fields — ${fieldDetails}`
            : `${msg} — ${fieldDetails}`;
    }
    return {
        msg,
        fields,
        code,
        status,
        retryable: status
            ? retryStatuses.has(status)
            : /ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(String(reqErr.message || '')),
    };
}
function parseJsonObject(
    value: unknown,
    label: string,
    node: INode,
    itemIndex: number,
): IDataObject {
    let parsed = value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            throw new NodeOperationError(node, `${label} cannot be empty. Enter a JSON object such as {}.`, { itemIndex });
        }
        try {
            parsed = JSON.parse(trimmed) as unknown;
        }
        catch (error) {
            throw new NodeOperationError(
                node,
                `${label} is not valid JSON: ${error instanceof Error ? error.message : 'check commas, quotes, and brackets'}.`,
                { itemIndex },
            );
        }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new NodeOperationError(node, `${label} must be a JSON object, not an array or scalar value.`, { itemIndex });
    }
    return asDataObject(parsed);
}
function parseJsonArray(
    value: unknown,
    label: string,
    node: INode,
    itemIndex: number,
): unknown[] {
    let parsed = value;
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value) as unknown;
        }
        catch (error) {
            throw new NodeOperationError(
                node,
                `${label} is not valid JSON: ${error instanceof Error ? error.message : 'check commas, quotes, and brackets'}.`,
                { itemIndex },
            );
        }
    }
    if (!Array.isArray(parsed)) {
        throw new NodeOperationError(node, `${label} must be a JSON array, for example [].`, { itemIndex });
    }
    return parsed;
}
function hasFields(value: unknown): boolean {
    return Boolean(value && typeof value === 'object' && Object.keys(value).length > 0);
}
function logicalRequestId() {
    return `${Date.now().toString(36)}-${randomString(24)}`;
}
function readTelemetryHeaders(context: string) {
    return {
        'X-SallaFlow-Logical-Request-Id': logicalRequestId(),
        'X-SallaFlow-Read-Context': context,
    };
}
function withReadTelemetry(options: IHttpRequestOptions, context: string): IHttpRequestOptions {
    const method = String(options.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD')
        return options;
    return {
        ...options,
        headers: {
            ...(options.headers || {}),
            ...readTelemetryHeaders(context),
        },
    };
}
// ── Helper: fetch up to 3 pages for dynamic dropdowns (Salla max: 60/page) ──
async function fetchPaginated(
    context: ILoadOptionsFunctions,
    endpoint: string,
    perPage = 60,
): Promise<IDataObject[]> {
    const pageSize = Math.max(1, Math.min(60, Number(perPage) || 60));
    const maxPages = 3;
    const data: IDataObject[] = [];
    for (let page = 1; page <= maxPages; page++) {
        const resp = await context.helpers.httpRequestWithAuthentication.call(
            context,
            'sallaFlowApi',
            {
            method: 'GET',
            url: `${API}/api/v1/salla/${endpoint}?per_page=${pageSize}&page=${page}`,
            headers: readTelemetryHeaders('dynamic-loader'),
            },
        ) as IDataObject;
        const pageData = Array.isArray(resp.data) ? resp.data as IDataObject[] : [];
        data.push(...pageData);
        const pagination = (resp.pagination || {}) as IDataObject;
        const totalPages = Number(pagination.totalPages || pagination.total_pages)
            || Math.ceil((Number(pagination.total) || data.length) / pageSize);
        if (pageData.length === 0 || page >= totalPages) break;
    }
    return data;
}
class SallaFlow implements INodeType {
    description: INodeTypeDescription = {
            displayName: 'SallaFlow', name: 'sallaFlow',
            icon: { light: 'file:icon.svg', dark: 'file:icon.dark.svg' },
            group: ['transform'], version: 5,
            subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
            description: 'Interact with your Salla store — orders, products, variants, inventory, customers, abandoned carts, coupons, brands, categories',
            defaults: { name: 'SallaFlow' },
            inputs: [NodeConnectionTypes.Main], outputs: [NodeConnectionTypes.Main],
            usableAsTool: true,
            credentials: [{ name: 'sallaFlowApi', required: true }],
            properties: [
                // ═══════════════════════════════════════════
                //  Resource
                // ═══════════════════════════════════════════
                { displayName: 'Resource', name: 'resource', type: 'options', noDataExpression: true,
                    options: [
                        { name: 'Abandoned Cart', value: 'abandonedCart', description: 'Retrieve abandoned carts and their recovery details. <a href="https://docs.salla.dev/841783f0" target="_blank">API Docs</a>.' },
                        { name: 'Brand', value: 'brand', description: 'Manage store brands. <a href="https://docs.salla.dev/5394213e0" target="_blank">API Docs</a>.' },
                        { name: 'Category', value: 'category', description: 'Manage store categories. <a href="https://docs.salla.dev/5394207e0" target="_blank">API Docs</a>.' },
                        { name: 'Coupon', value: 'coupon', description: 'Manage store coupons. <a href="https://docs.salla.dev/5394275e0" target="_blank">API Docs</a>.' },
                        { name: 'Custom API Call', value: 'customApiCall', description: 'Make a custom API call to any Salla endpoint' },
                        { name: 'Customer', value: 'customer', description: 'Manage store customers. <a href="https://docs.salla.dev/5394121e0" target="_blank">API Docs</a>.' },
                        { name: 'Feedback', value: 'feedback', description: 'List product reviews, questions, ratings and store feedbacks. <a href="https://docs.salla.dev/5394279e0" target="_blank">API Docs</a>.' },
                        { name: 'Order', value: 'order', description: 'Manage store orders. <a href="https://docs.salla.dev/5394146e0" target="_blank">API Docs</a>.' },
                        { name: 'Product', value: 'product', description: 'Manage store products. <a href="https://docs.salla.dev/5394168e0" target="_blank">API Docs</a>.' },
                        { name: 'Product Option', value: 'productOption', description: 'Manage product options (variants and form inputs). <a href="https://docs.salla.dev/5394194e0" target="_blank">API Docs</a>.' },
                        { name: 'Product Variant', value: 'productVariant', description: 'List and safely update product SKUs/variants. <a href="https://docs.salla.dev/841799f0" target="_blank">API Docs</a>.' },
                    ], default: 'order' },
                // ═══════════════════════════════════════════
                //  Operations
                // ═══════════════════════════════════════════
                { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
                    displayOptions: { show: { resource: ['abandonedCart'] } },
                    options: [
                        { name: 'Get', value: 'get', action: 'Get abandoned cart', description: 'Get the complete details of an abandoned cart by ID. <a href="https://docs.salla.dev/5394139e0" target="_blank">API Docs</a>.' },
                        { name: 'Get Many', value: 'getAll', action: 'List abandoned carts', description: 'Retrieve abandoned carts for recovery workflows. <a href="https://docs.salla.dev/5394138e0" target="_blank">API Docs</a>.' },
                    ], default: 'getAll' },
                { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
                    displayOptions: { show: { resource: ['order'] } },
                    options: [
                        { name: 'Cancel', value: 'cancel', action: 'Cancel order', description: 'Cancel an order. <a href="https://docs.salla.dev/5394148e0" target="_blank">API Docs</a>.' },
                        { name: 'Create', value: 'create', action: 'Create order', description: 'Create a new order. <a href="https://docs.salla.dev/5394145e0" target="_blank">API Docs</a>.' },
                        { name: 'Get', value: 'get', action: 'Get order', description: 'Get a single order by ID. <a href="https://docs.salla.dev/5394147e0" target="_blank">API Docs</a>.' },
                        { name: 'Get Many', value: 'getAll', action: 'List orders', description: 'Retrieve a list of orders. <a href="https://docs.salla.dev/5394146e0" target="_blank">API Docs</a>.' },
                        { name: 'Update Status', value: 'updateStatus', action: 'Update order status', description: 'Update the status of an order. <a href="https://docs.salla.dev/5394148e0" target="_blank">API Docs</a>.' },
                    ], default: 'get' },
                { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
                    displayOptions: { show: { resource: ['product'] } },
                    options: [
                        { name: 'Attach Image', value: 'attachImage', action: 'Attach image to product', description: 'Attach an image to a product. <a href="https://docs.salla.dev/5394187e0" target="_blank">API Docs</a>.' },
                        { name: 'Bulk Update Inventory', value: 'updateInventoryBulk', action: 'Bulk update product inventory', description: 'Adjust multiple product or variant quantities atomically. Increment/decrement is recommended over overwrite. <a href="https://docs.salla.dev/5394192e0" target="_blank">API Docs</a>' },
                        { name: 'Create', value: 'create', action: 'Create product', description: 'Create a new product. <a href="https://docs.salla.dev/5394167e0" target="_blank">API Docs</a>.' },
                        { name: 'Delete', value: 'delete', action: 'Delete product', description: 'Delete a product. <a href="https://docs.salla.dev/5394171e0" target="_blank">API Docs</a>.' },
                        { name: 'Get', value: 'get', action: 'Get product', description: 'Get a single product by ID. <a href="https://docs.salla.dev/5394169e0" target="_blank">API Docs</a>.' },
                        { name: 'Get Many', value: 'getAll', action: 'List products', description: 'Retrieve a list of products. <a href="https://docs.salla.dev/5394168e0" target="_blank">API Docs</a>.' },
                        { name: 'Update', value: 'update', action: 'Update product', description: 'Update an existing product. <a href="https://docs.salla.dev/5394170e0" target="_blank">API Docs</a>.' },
                        { name: 'Update Quantity', value: 'updateQuantity', action: 'Update product quantity', description: 'Update the quantity of a product. <a href="https://docs.salla.dev/5394170e0" target="_blank">API Docs</a>.' },
                    ], default: 'get' },
                { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
                    displayOptions: { show: { resource: ['productOption'] } },
                    options: [
                        { name: 'Create', value: 'create', action: 'Create product option', description: 'Create one or more options (variants or form inputs) on a product. <a href="https://docs.salla.dev/5394194e0" target="_blank">API Docs</a>.' },
                        { name: 'Delete', value: 'delete', action: 'Delete product option', description: 'Delete an option and its values/variants from a product. <a href="https://docs.salla.dev/5394197e0" target="_blank">API Docs</a>.' },
                        { name: 'Get', value: 'get', action: 'Get product option', description: 'Get details of a specific option on a product. <a href="https://docs.salla.dev/5394195e0" target="_blank">API Docs</a>.' },
                        { name: 'Get Many', value: 'getAll', action: 'List product options', description: 'List many options for a specific product' },
                        { name: 'Update', value: 'update', action: 'Update product option', description: 'Update a specific option on a product. SAFE: preserves existing values unless "Replace Values" is ON. <a href="https://docs.salla.dev/5394196e0" target="_blank">API Docs</a>' },
                        { name: 'Update Value', value: 'updateValue', action: 'Update option value', description: 'Safely change one option value’s name, price, display, or default state. Variant stock belongs under Product Variant. <a href="https://docs.salla.dev/5394200e0" target="_blank">API Docs</a>' },
                    ], default: 'getAll' },
                { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
                    displayOptions: { show: { resource: ['productVariant'] } },
                    options: [
                        { name: 'Get', value: 'get', action: 'Get product variant', description: 'Get one variant/SKU by variant ID. <a href="https://docs.salla.dev/5394203e0" target="_blank">API Docs</a>.' },
                        { name: 'Get Many', value: 'getAll', action: 'List product variants', description: 'List many variants/SKUs for a product. <a href="https://docs.salla.dev/5394202e0" target="_blank">API Docs</a>.' },
                        { name: 'Update', value: 'update', action: 'Update product variant', description: 'Update variant SKU, prices, barcode, weight, identifiers, or branch quantities. <a href="https://docs.salla.dev/5394204e0" target="_blank">API Docs</a>.' },
                        { name: 'Update Quantity', value: 'updateQuantity', action: 'Update product variant quantity', description: 'Adjust variant stock through Salla’s recommended Bulk Quantities endpoint; supports increment, decrement, and overwrite. <a href="https://docs.salla.dev/5394192e0" target="_blank">API Docs</a>.' },
                    ], default: 'getAll' },
                { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
                    displayOptions: { show: { resource: ['customer'] } },
                    options: [
                        { name: 'Create', value: 'create', action: 'Create customer', description: 'Create a new customer. <a href="https://docs.salla.dev/5394120e0" target="_blank">API Docs</a>.' },
                        { name: 'Get', value: 'get', action: 'Get customer', description: 'Get a single customer by ID. <a href="https://docs.salla.dev/5394122e0" target="_blank">API Docs</a>.' },
                        { name: 'Get Many', value: 'getAll', action: 'List customers', description: 'Retrieve a list of customers. <a href="https://docs.salla.dev/5394121e0" target="_blank">API Docs</a>.' },
                        { name: 'Update', value: 'update', action: 'Update customer', description: 'Update an existing customer. <a href="https://docs.salla.dev/5394123e0" target="_blank">API Docs</a>.' },
                    ], default: 'get' },
                { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
                    displayOptions: { show: { resource: ['coupon'] } },
                    options: [
                        { name: 'Create', value: 'create', action: 'Create coupon', description: 'Create a new coupon. <a href="https://docs.salla.dev/5394274e0" target="_blank">API Docs</a>.' },
                        { name: 'Delete', value: 'delete', action: 'Delete coupon', description: 'Delete a coupon. <a href="https://docs.salla.dev/5394278e0" target="_blank">API Docs</a>.' },
                        { name: 'Get', value: 'get', action: 'Get coupon', description: 'Get a single coupon by ID. <a href="https://docs.salla.dev/5394276e0" target="_blank">API Docs</a>.' },
                        { name: 'Get Many', value: 'getAll', action: 'List coupons', description: 'Retrieve a list of coupons. <a href="https://docs.salla.dev/5394275e0" target="_blank">API Docs</a>.' },
                        { name: 'Update', value: 'update', action: 'Update coupon', description: 'Update an existing coupon. <a href="https://docs.salla.dev/5394277e0" target="_blank">API Docs</a>.' },
                    ], default: 'get' },
                { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
                    displayOptions: { show: { resource: ['brand'] } },
                    options: [
                        { name: 'Create', value: 'create', action: 'Create brand', description: 'Create a new brand. <a href="https://docs.salla.dev/5394212e0" target="_blank">API Docs</a>.' },
                        { name: 'Delete', value: 'delete', action: 'Delete brand', description: 'Delete a brand. <a href="https://docs.salla.dev/5394216e0" target="_blank">API Docs</a>.' },
                        { name: 'Get', value: 'get', action: 'Get brand', description: 'Get a single brand by ID. <a href="https://docs.salla.dev/5394214e0" target="_blank">API Docs</a>.' },
                        { name: 'Get Many', value: 'getAll', action: 'List brands', description: 'Retrieve a list of brands. <a href="https://docs.salla.dev/5394213e0" target="_blank">API Docs</a>.' },
                        { name: 'Update', value: 'update', action: 'Update brand', description: 'Update an existing brand. <a href="https://docs.salla.dev/5394215e0" target="_blank">API Docs</a>.' },
                    ], default: 'get' },
                { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
                    displayOptions: { show: { resource: ['category'] } },
                    options: [
                        { name: 'Create', value: 'create', action: 'Create category', description: 'Create a new category. <a href="https://docs.salla.dev/5394206e0" target="_blank">API Docs</a>.' },
                        { name: 'Delete', value: 'delete', action: 'Delete category', description: 'Delete a category. <a href="https://docs.salla.dev/5394210e0" target="_blank">API Docs</a>.' },
                        { name: 'Get', value: 'get', action: 'Get category', description: 'Get a single category by ID. <a href="https://docs.salla.dev/5394208e0" target="_blank">API Docs</a>.' },
                        { name: 'Get Many', value: 'getAll', action: 'List categories', description: 'Retrieve a list of categories. <a href="https://docs.salla.dev/5394207e0" target="_blank">API Docs</a>.' },
                        { name: 'Update', value: 'update', action: 'Update category', description: 'Update an existing category. <a href="https://docs.salla.dev/5394209e0" target="_blank">API Docs</a>.' },
                    ], default: 'get' },
                { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
                    displayOptions: { show: { resource: ['feedback'] } },
                    options: [
                        { name: 'Get Many', value: 'getAll', action: 'List feedbacks', description: 'List product feedbacks, reviews, questions, shipping ratings, and store feedbacks. <a href="https://docs.salla.dev/5394279e0" target="_blank">API Docs</a>.' },
                    ], default: 'getAll' },
                { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
                    displayOptions: { show: { resource: ['customApiCall'] } },
                    options: [
                        { name: 'Make Request', value: 'makeRequest', action: 'Make custom API request' },
                    ], default: 'makeRequest' },
                // ═══════════════════════════════════════════
                //  ID Fields (Dynamic Dropdowns)
                // ═══════════════════════════════════════════
                { displayName: 'Abandoned Cart Name or ID', name: 'abandonedCartId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getAbandonedCarts' },
                    displayOptions: { show: { resource: ['abandonedCart'], operation: ['get'] } },
                    description: 'Select from recently loaded carts, or switch this field to Expression and provide an ID from Get Many or a trigger. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Order Name or ID', name: 'orderId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getOrders' },
                    displayOptions: { show: { resource: ['order'], operation: ['get'] } },
                    description: 'Select from recently loaded orders, or switch this field to Expression and provide an ID from a trigger. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Apply to Multiple Orders', name: 'orderUseMultiple', type: 'boolean', default: false,
                    displayOptions: { show: { resource: ['order'], operation: ['updateStatus', 'cancel'] } },
                    description: 'Whether to apply the selected status to several orders in one execution. Each order is processed separately and the node returns a success/failure summary.' },
                { displayName: 'Order Name or ID', name: 'orderId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getOrders' },
                    displayOptions: { show: { resource: ['order'], operation: ['updateStatus', 'cancel'], orderUseMultiple: [false] } },
                    description: 'Select one order, or switch this field to Expression and provide an order ID. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Order Names or IDs', name: 'orderIds', type: 'multiOptions', required: true, default: [],
                    typeOptions: { loadOptionsMethod: 'getOrders' },
                    displayOptions: { show: { resource: ['order'], operation: ['updateStatus', 'cancel'], orderUseMultiple: [true] } },
                    description: 'Select all orders that should receive this status. Expressions may return an array or comma-separated IDs. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Product Name or ID', name: 'productId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getProducts' },
                    displayOptions: { show: { resource: ['product'], operation: ['get', 'update', 'delete', 'attachImage', 'updateQuantity'] } },
                    description: 'Shows up to the latest 180 products. Use an expression for other product IDs. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Product Name or ID', name: 'productId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getProducts' },
                    displayOptions: { show: { resource: ['productVariant'] } },
                    description: 'Pick the parent product. This is required to list variants and populate the Variant dropdown. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Variant Name or ID', name: 'variantId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getVariantsForSelectedProduct', loadOptionsDependsOn: ['productId'] },
                    displayOptions: { show: { resource: ['productVariant'], operation: ['get', 'update', 'updateQuantity'] } },
                    description: 'Pick a product first, then select its variant. You can also use an expression with a variant ID. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Customer Name or ID', name: 'customerId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getCustomers' },
                    displayOptions: { show: { resource: ['customer'], operation: ['get', 'update'] } },
                    description: 'Loads up to 180 recent customers. Search the loaded choices, or switch to Expression for any other customer ID. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Coupon Name or ID', name: 'couponId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getCoupons' },
                    displayOptions: { show: { resource: ['coupon'], operation: ['get', 'update', 'delete'] } },
                    description: 'Loads up to 180 recent coupons. Search the loaded choices, or switch to Expression for any other coupon ID. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Brand Name or ID', name: 'brandId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getBrands' },
                    displayOptions: { show: { resource: ['brand'], operation: ['get', 'update', 'delete'] } },
                    description: 'Loads up to 180 recent brands. Search the loaded choices, or switch to Expression for any other brand ID. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Category Name or ID', name: 'categoryId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getCategories' },
                    displayOptions: { show: { resource: ['category'], operation: ['get', 'update', 'delete'] } },
                    description: 'Loads up to 180 recent categories. Search the loaded choices, or switch to Expression for any other category ID. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                // ═══════════════════════════════════════════
                //  Pagination
                // ═══════════════════════════════════════════
                { displayName: 'Return All', name: 'returnAll', type: 'boolean', default: false,
                    displayOptions: { show: { resource: ['abandonedCart', 'order', 'product', 'productVariant', 'customer', 'coupon', 'brand', 'category', 'feedback'], operation: ['getAll'] } },
                    description: 'Whether to return all results or only up to a given limit' },
                { displayName: 'Limit', name: 'limit', type: 'number', typeOptions: { minValue: 1, maxValue: 30 }, default: 50,
                    displayOptions: { show: { resource: ['order'], operation: ['getAll'], returnAll: [false] } },
                    description: 'Max number of results to return' },
                { displayName: 'Limit', name: 'limit', type: 'number', typeOptions: { minValue: 1, maxValue: 60 }, default: 50,
                    displayOptions: { show: { resource: ['abandonedCart', 'product', 'productVariant', 'customer', 'coupon', 'brand', 'category', 'feedback'], operation: ['getAll'], returnAll: [false] } },
                    description: 'Max number of results to return' },
                { displayName: 'Page', name: 'page', type: 'number', typeOptions: { minValue: 1 }, default: 1,
                    displayOptions: { show: { resource: ['abandonedCart', 'order', 'product', 'productVariant', 'customer', 'coupon', 'brand', 'category', 'feedback'], operation: ['getAll'], returnAll: [false] } } },
                // ═══════════════════════════════════════════
                //  Custom API Call Fields
                // ═══════════════════════════════════════════
                { displayName: 'HTTP Method', name: 'customMethod', type: 'options', default: 'GET',
                    displayOptions: { show: { resource: ['customApiCall'] } },
                    options: [
                        { name: 'DELETE', value: 'DELETE' },
                        { name: 'GET', value: 'GET' },
                        { name: 'PATCH', value: 'PATCH' },
                        { name: 'POST', value: 'POST' },
                        { name: 'PUT', value: 'PUT' },
                    ],
                    description: 'The HTTP method for the request' },
                { displayName: 'Endpoint', name: 'customEndpoint', type: 'string', required: true, default: '',
                    displayOptions: { show: { resource: ['customApiCall'] } },
                    placeholder: '/products or /products/123/options',
                    description: 'Salla API endpoint path (e.g. /products, /orders/123). The base URL https://api.salla.dev/admin/v2 is added automatically.' },
                { displayName: 'JSON Body', name: 'customBody', type: 'json', default: '{}',
                    displayOptions: { show: { resource: ['customApiCall'], customMethod: ['POST', 'PUT', 'PATCH'] } },
                    description: 'JSON object to send with POST, PUT, or PATCH requests. Invalid JSON stops execution before any request is made.' },
                { displayName: 'Query Parameters', name: 'customQuery', type: 'string', default: '',
                    displayOptions: { show: { resource: ['customApiCall'] } },
                    placeholder: 'per_page=50&page=1',
                    description: 'Query string parameters (without the ? prefix)' },
                { displayName: 'Filters', name: 'abandonedCartFilters', type: 'collection', placeholder: 'Add Filter', default: {},
                    displayOptions: { show: { resource: ['abandonedCart'], operation: ['getAll'] } },
                    options: [
                        { displayName: 'Keyword', name: 'keyword', type: 'string', default: '',
                            description: 'Search abandoned carts using Salla’s keyword filter' },
                    ] },
                { displayName: 'Filters', name: 'orderFilters', type: 'collection', placeholder: 'Add Filter', default: {},
                    displayOptions: { show: { resource: ['order'], operation: ['getAll'] } },
                    options: [
                        { displayName: 'Customer ID', name: 'customer_id', type: 'string', default: '',
                            description: 'Filter orders belonging to this customer ID' },
                        { displayName: 'From Date', name: 'from_date', type: 'string', default: '',
                            placeholder: '2026-07-01',
                            description: 'Start date in YYYY-MM-DD format' },
                        { displayName: 'Keyword', name: 'keyword', type: 'string', default: '',
                            description: 'Search using a value supported by Salla, such as an order reference or customer detail' },
                        { displayName: 'Payment Method', name: 'payment_method', type: 'string', default: '',
                            placeholder: 'cod',
                            description: 'Filter by Salla payment-method code' },
                        { displayName: 'Reference ID', name: 'reference_id', type: 'string', default: '',
                            description: 'Return the order with this merchant-facing reference number' },
                        { displayName: 'Status ID or Slug', name: 'status', type: 'string', default: '',
                            description: 'Filter by an order status ID or slug supported by Salla' },
                        { displayName: 'To Date', name: 'to_date', type: 'string', default: '',
                            placeholder: '2026-07-31',
                            description: 'End date in YYYY-MM-DD format' },
                    ] },
                { displayName: 'Filters', name: 'customerFilters', type: 'collection', placeholder: 'Add Filter', default: {},
                    displayOptions: { show: { resource: ['customer'], operation: ['getAll'] } },
                    options: [
                        { displayName: 'Keyword', name: 'keyword', type: 'string', default: '',
                            description: 'Search customer name, mobile number, or email address' },
                        { displayName: 'Created From', name: 'date_from', type: 'string', default: '',
                            placeholder: '2026-07-01',
                            description: 'Start date in YYYY-MM-DD format' },
                        { displayName: 'Created To', name: 'date_to', type: 'string', default: '',
                            placeholder: '2026-07-31',
                            description: 'End date in YYYY-MM-DD format' },
                    ] },
                { displayName: 'Filters', name: 'couponFilters', type: 'collection', placeholder: 'Add Filter', default: {},
                    displayOptions: { show: { resource: ['coupon'], operation: ['getAll'] } },
                    options: [
                        { displayName: 'Keyword', name: 'keyword', type: 'string', default: '',
                            description: 'Search by coupon code or another keyword supported by Salla' },
                        { displayName: 'Creation Date Range', name: 'creation_date', type: 'string', default: '',
                            placeholder: '2026-01-01,2026-12-31',
                            description: 'Comma-separated start and end dates as documented by Salla' },
                        { displayName: 'Expiration Date Range', name: 'expiration_date', type: 'string', default: '',
                            placeholder: '2026-01-01,2026-12-31',
                            description: 'Comma-separated start and end dates as documented by Salla' },
                    ] },
                { displayName: 'Filters', name: 'brandFilters', type: 'collection', placeholder: 'Add Filter', default: {},
                    displayOptions: { show: { resource: ['brand'], operation: ['getAll'] } },
                    options: [
                        { displayName: 'Keyword', name: 'keyword', type: 'string', default: '',
                            description: 'Search by brand name' },
                    ] },
                { displayName: 'Filters', name: 'categoryFilters', type: 'collection', placeholder: 'Add Filter', default: {},
                    displayOptions: { show: { resource: ['category'], operation: ['getAll'] } },
                    options: [
                        { displayName: 'Keyword', name: 'keyword', type: 'string', default: '',
                            description: 'Search by category name' },
                        { displayName: 'Status', name: 'status', type: 'options', default: '',
                            options: [
                                { name: 'All', value: '' },
                                { name: 'Active', value: 'active' },
                                { name: 'Hidden', value: 'hidden' },
                            ],
                            description: 'Filter categories by visibility status' },
                    ] },
                { displayName: 'Filters', name: 'feedbackFilters', type: 'collection', placeholder: 'Add Filter', default: {},
                    displayOptions: { show: { resource: ['feedback'], operation: ['getAll'] } },
                    options: [
                        { displayName: 'Blog IDs', name: 'blogs', type: 'string', default: '',
                            placeholder: '2345231543,2345231544',
                            description: 'Comma-separated list of blog IDs to filter feedbacks' },
                        { displayName: 'Customer Names or IDs', name: 'customers', type: 'multiOptions', default: [],
                            typeOptions: { loadOptionsMethod: 'getCustomers' },
                            description: 'Select one or more customers. Existing expressions that return comma-separated IDs remain supported. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        { displayName: 'End Date', name: 'end_date', type: 'string', default: '',
                            placeholder: '2024-10-02',
                            description: 'End date filter in YYYY-MM-DD format' },
                        { displayName: 'Has Reply', name: 'reply', type: 'boolean', default: false,
                            description: 'Whether to return only feedbacks that have a reply' },
                        { displayName: 'Keyword', name: 'keyword', type: 'string', default: '',
                            description: 'Filter by the content of the feedback' },
                        { displayName: 'Product Names or IDs', name: 'products', type: 'multiOptions', default: [],
                            typeOptions: { loadOptionsMethod: 'getProducts' },
                            description: 'Select one or more products. Existing expressions that return comma-separated IDs remain supported. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        { displayName: 'Published', name: 'publish', type: 'boolean', default: false,
                            description: 'Whether to return only feedbacks that are published' },
                        { displayName: 'Stars', name: 'stars', type: 'multiOptions', default: [],
                            options: [
                                { name: '1 Star', value: '1' },
                                { name: '2 Stars', value: '2' },
                                { name: '3 Stars', value: '3' },
                                { name: '4 Stars', value: '4' },
                                { name: '5 Stars', value: '5' },
                            ],
                            description: 'Filter by star rating' },
                        { displayName: 'Start Date', name: 'start_date', type: 'string', default: '',
                            placeholder: '2020-01-02',
                            description: 'Start date filter in YYYY-MM-DD format' },
                        { displayName: 'Types', name: 'type', type: 'multiOptions', default: [],
                            options: [
                                { name: 'Blog Feedback', value: 'blog' },
                                { name: 'Product Question', value: 'ask' },
                                { name: 'Product Review', value: 'product' },
                                { name: 'Reported Feedback', value: 'reported' },
                                { name: 'Shipping Rating', value: 'shipping' },
                                { name: 'Store Feedback', value: 'store' },
                            ],
                            description: 'Filter by one or more Salla feedback types. Leave empty to fetch all types. Selecting multiple types makes one paginated request chain per type, merges duplicate IDs, and applies Limit to the combined result.' },
                    ] },
                { displayName: 'Filters', name: 'productFilters', type: 'collection', placeholder: 'Add Filter', default: {},
                    displayOptions: { show: { resource: ['product'], operation: ['getAll'] } },
                    options: [
                        { displayName: 'Keyword', name: 'keyword', type: 'string', default: '',
                            description: 'Filter products by name or SKU' },
                        { displayName: 'Status', name: 'status', type: 'options', default: '',
                            options: [
                                { name: 'All', value: '' },
                                { name: 'On Sale (Sale)', value: 'sale' },
                                { name: 'Hidden (Hidden)', value: 'hidden' },
                                { name: 'Out of Stock (Out)', value: 'out' },
                            ],
                            description: 'Filter by product status' },
                        { displayName: 'Category Names or IDs', name: 'category', type: 'multiOptions', default: [],
                            typeOptions: { loadOptionsMethod: 'getCategories' },
                            description: 'Filter by one or more categories. Existing expressions that return a single ID or comma-separated IDs remain supported. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                    ] },
                // ═══════════════════════════════════════════
                //  Create / Update Input Mode
                // ═══════════════════════════════════════════
                { displayName: 'Use Advanced JSON', name: 'useCustomJson', type: 'boolean', default: false,
                    displayOptions: { show: { resource: ['order', 'product', 'customer', 'coupon', 'brand', 'category'], operation: ['create', 'update'] } },
                    description: 'Whether to replace all easy fields with one JSON object. Turn this off for guided fields, or on for payloads copied from Salla documentation.' },
                { displayName: 'Advanced JSON Body', name: 'customJsonBody', type: 'json', default: '{}',
                    displayOptions: { show: { resource: ['order', 'product', 'customer', 'coupon', 'brand', 'category'], useCustomJson: [true], operation: ['create', 'update'] } },
                    description: 'JSON object sent directly to Salla. Guided fields are hidden and ignored in this mode.' },
                // ═══════════════════════════════════════════
                //  Order: Update Status
                // ═══════════════════════════════════════════
                { displayName: 'Status Name or ID', name: 'statusId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getOrderStatuses' },
                    displayOptions: { show: { resource: ['order'], operation: ['updateStatus'] } },
                    description: 'Select the new order status. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Canceled Status Name or ID', name: 'statusId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getCanceledOrderStatuses' },
                    displayOptions: { show: { resource: ['order'], operation: ['cancel'] } },
                    description: 'Only statuses whose name or slug indicates cancellation are shown, reducing the risk of choosing the wrong status. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                // ═══════════════════════════════════════════
                //  Order: Create Fields
                // ═══════════════════════════════════════════
                { displayName: 'Customer Name or ID', name: 'orderCustomerId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getCustomers' },
                    displayOptions: { show: { resource: ['order'], operation: ['create'], useCustomJson: [false] } },
                    description: 'Select the customer for this order. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Add Multiple Products', name: 'orderUseMultipleProducts', type: 'boolean', default: false,
                    displayOptions: { show: { resource: ['order'], operation: ['create'], useCustomJson: [false] } },
                    description: 'Whether to build the order from several product lines. Leave off to keep the original single-product fields.' },
                { displayName: 'Product Name or ID', name: 'orderProductId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getProducts' },
                    displayOptions: { show: { resource: ['order'], operation: ['create'], useCustomJson: [false], orderUseMultipleProducts: [false] } },
                    description: 'Select the product to add to this order. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Quantity', name: 'orderProductQty', type: 'number', required: true, default: 1,
                    typeOptions: { minValue: 1 },
                    displayOptions: { show: { resource: ['order'], operation: ['create'], useCustomJson: [false], orderUseMultipleProducts: [false] } },
                    description: 'Number of units of this product' },
                { displayName: 'Products', name: 'orderProducts', type: 'fixedCollection', default: {},
                    typeOptions: { multipleValues: true },
                    displayOptions: { show: { resource: ['order'], operation: ['create'], useCustomJson: [false], orderUseMultipleProducts: [true] } },
                    description: 'Add every product line needed in the order. Product options are validated against the selected product.',
                    options: [{
                        name: 'product',
                        displayName: 'Product',
                        values: [
                            { displayName: 'Product Name or ID', name: 'productId', type: 'options',
																																																																									description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>', required: true, default: '',
                                typeOptions: { loadOptionsMethod: 'getProducts' } },
                            { displayName: 'Quantity', name: 'quantity', type: 'number', required: true, default: 1,
                                typeOptions: { minValue: 1 } },
                            { displayName: 'Product Option Names or IDs', name: 'options', type: 'multiOptions', default: [],
                                typeOptions: { loadOptionsMethod: 'getProductOptions' },
                                description: 'Select only values belonging to this product line. Leave empty for products without required options. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        ],
                    }] },
                { displayName: 'Payment Status', name: 'orderPaymentStatus', type: 'options', required: true, default: 'pending_payment',
                    displayOptions: { show: { resource: ['order'], operation: ['create'], useCustomJson: [false] } },
                    options: [
                        { name: 'Pending Payment', value: 'pending_payment' },
                        { name: 'Paid', value: 'paid' },
                    ],
                    description: 'Whether the order is already paid or awaiting payment' },
                { displayName: 'Payment Method', name: 'orderPaymentMethod', type: 'options', required: true, default: 'cod',
                    displayOptions: { show: { resource: ['order'], operation: ['create'], orderPaymentStatus: ['paid'], useCustomJson: [false] } },
                    options: [
                        { name: 'Cash on Delivery', value: 'cod' },
                    ],
                    description: 'Payment method. Only COD can be marked as paid via API.' },
                { displayName: 'Accepted Payment Methods', name: 'orderAcceptedMethods', type: 'multiOptions', required: true,
                    default: ['cod'],
                    displayOptions: { show: { resource: ['order'], operation: ['create'], orderPaymentStatus: ['pending_payment'], useCustomJson: [false] } },
                    options: [
                        { name: 'Cash on Delivery', value: 'cod' },
                        { name: 'Bank Transfer', value: 'bank' },
                    ],
                    description: 'Which payment methods the customer can use to complete the order' },
                { displayName: 'Delivery Method', name: 'orderDeliveryMethod', type: 'options', default: '',
                    displayOptions: { show: { resource: ['order'], operation: ['create'], useCustomJson: [false] } },
                    options: [
                        { name: 'None (Digital Products)', value: '' },
                        { name: 'Pickup (From Branch)', value: 'pickup' },
                        { name: 'Shipping (Delivery)', value: 'shipping' },
                    ],
                    description: 'Required for physical products. Digital products can use "None". Pickup requires Branch ID in Additional Fields.' },
                { displayName: 'Courier Name or ID', name: 'orderCourierId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getShippingCompanies' },
                    displayOptions: { show: { resource: ['order'], operation: ['create'], orderDeliveryMethod: ['shipping'] } },
                    description: 'Shipping company used to deliver the order. Required when Delivery Method is Shipping. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Shipping Address', name: 'orderShipTo', type: 'collection', placeholder: 'Add Address Field', default: {},
                    displayOptions: { show: { resource: ['order'], operation: ['create'], orderDeliveryMethod: ['shipping'] } },
                    options: [
                        { displayName: 'Additional Number', name: 'additional_number', type: 'string', default: '' },
                        { displayName: 'Address', name: 'address', type: 'string', default: '' },
                        { displayName: 'Address Line', name: 'address_line', type: 'string', default: '' },
                        { displayName: 'Block / District Name', name: 'block', type: 'string', default: '' },
                        { displayName: 'Building Number', name: 'building_number', type: 'string', default: '' },
                        { displayName: 'City ID', name: 'city', type: 'string', default: '',
                            description: 'Numeric Salla city ID' },
                        { displayName: 'Country ID', name: 'country', type: 'string', default: '',
                            description: 'Numeric Salla country ID' },
                        { displayName: 'District ID', name: 'district', type: 'string', default: '',
                            description: 'Numeric Salla district ID, when available' },
                        { displayName: 'Latitude', name: 'latitude', type: 'number', default: 0 },
                        { displayName: 'Longitude', name: 'longitude', type: 'number', default: 0 },
                        { displayName: 'Postal Code', name: 'postal_code', type: 'string', default: '' },
                        { displayName: 'Recipient Email', name: 'email', type: 'string',
																																																																									placeholder: 'name@email.com', default: '' },
                        { displayName: 'Recipient Name', name: 'name', type: 'string', default: '' },
                        { displayName: 'Recipient Phone', name: 'phone', type: 'string', default: '' },
                        { displayName: 'Short National Address', name: 'short_address', type: 'string', default: '' },
                        { displayName: 'Street Number', name: 'street_number', type: 'string', default: '' },
                    ],
                    description: 'Destination fields required by Salla for delivery orders. National-address requirements may vary by country.' },
                { displayName: 'Product Option Names or IDs', name: 'orderProductOptions', type: 'multiOptions', default: [],
                    typeOptions: { loadOptionsMethod: 'getProductOptions' },
                    displayOptions: { show: { resource: ['order'], operation: ['create'], useCustomJson: [false], orderUseMultipleProducts: [false] } },
                    description: 'Select product options (size, color, etc.) from up to 180 recent products. Only pick options matching the selected product. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Additional Fields', name: 'orderAdditionalFields', type: 'collection', placeholder: 'Add Field', default: {},
                    displayOptions: { show: { resource: ['order'], operation: ['create'], useCustomJson: [false] } },
                    options: [
                        { displayName: 'Additional Products (JSON)', name: 'extra_products', type: 'json', default: '[]',
                            description: 'Additional products as a JSON array using Salla’s identifier type, identifier, quantity, and options fields' },
                        { displayName: 'Coupon Name or ID', name: 'coupon_code', type: 'options', default: '',
                            typeOptions: { loadOptionsMethod: 'getCouponsForOrder' },
                            description: 'Apply a coupon to this order. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        { displayName: 'Branch Name or ID', name: 'branch_id', type: 'options', default: '',
                            typeOptions: { loadOptionsMethod: 'getBranches' },
                            description: 'Required if delivery method is Pickup. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                    ] },
                // ═══════════════════════════════════════════
                //  PRODUCT: Create Fields
                // ═══════════════════════════════════════════
                { displayName: 'Product Name', name: 'productName', type: 'string', required: true, default: '',
                    displayOptions: { show: { resource: ['product'], operation: ['create'], useCustomJson: [false] } },
                    description: 'The product name shown to customers in your store' },
                { displayName: 'Price', name: 'productPrice', type: 'number', required: true, default: 0,
                    displayOptions: { show: { resource: ['product'], operation: ['create'], useCustomJson: [false] } },
                    description: 'Product price in your store currency (e.g. 99.99)' },
                { displayName: 'Product Type', name: 'productType', type: 'options', default: 'product',
                    displayOptions: { show: { resource: ['product'], operation: ['create'], useCustomJson: [false] } },
                    options: [
                        { name: 'Booking', value: 'booking' },
                        { name: 'Codes', value: 'codes' },
                        { name: 'Digital', value: 'digital' },
                        { name: 'Donating', value: 'donating' },
                        { name: 'Food', value: 'food' },
                        { name: 'Group Products', value: 'group_products' },
                        { name: 'Product', value: 'product' },
                        { name: 'Service', value: 'service' },
                    ] },
                { displayName: 'Quantity', name: 'productQuantity', type: 'number', default: 0,
                    displayOptions: { show: { resource: ['product'], operation: ['create'], useCustomJson: [false] } },
                    description: 'Stock quantity. Set 0 for unlimited or out of stock.' },
                { displayName: 'Description', name: 'productDescription', type: 'string', typeOptions: { rows: 4 }, default: '',
                    displayOptions: { show: { resource: ['product'], operation: ['create'], useCustomJson: [false] } },
                    description: 'Product description. Supports HTML tags.' },
                { displayName: 'SKU', name: 'productSku', type: 'string', default: '',
                    displayOptions: { show: { resource: ['product'], operation: ['create'], useCustomJson: [false] } },
                    description: 'Stock Keeping Unit — unique product identifier, e.g. TSHIRT-BLK-XL' },
                { displayName: 'Sale Price', name: 'productSalePrice', type: 'number', default: 0,
                    displayOptions: { show: { resource: ['product'], operation: ['create'], useCustomJson: [false] } },
                    description: 'Discounted price. Leave 0 for no discount.' },
                { displayName: 'Requires Shipping', name: 'productRequireShipping', type: 'boolean', default: true,
                    displayOptions: { show: { resource: ['product'], operation: ['create'], useCustomJson: [false] } } },
                // ── Product Create: Additional Fields ──
                { displayName: 'Additional Fields', name: 'productAdditionalFields', type: 'collection', placeholder: 'Add Field', default: {},
                    displayOptions: { show: { resource: ['product'], operation: ['create'], useCustomJson: [false] } },
                    options: [
                        { displayName: 'Brand Name or ID', name: 'brand_id', type: 'options', default: '',
                            typeOptions: { loadOptionsMethod: 'getBrands' },
                            description: 'Select a brand for this product. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        { displayName: 'Category Names or IDs', name: 'categories', type: 'multiOptions', default: [],
                            typeOptions: { loadOptionsMethod: 'getCategories' },
                            description: 'Select one or more categories for this product. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        { displayName: 'Cost Price', name: 'cost_price', type: 'number', default: 0,
                            description: 'Your cost for this product (not shown to customers)' },
                        { displayName: 'GTIN (Global Trade Item Number)', name: 'gtin', type: 'string', default: '',
                            placeholder: '0123456789012',
                            description: 'Barcode number (UPC/EAN/ISBN). 8, 12, 13 or 14 digits.' },
                        { displayName: 'Image URL', name: 'image_url', type: 'string', default: '',
                            placeholder: 'https://example.com/product-image.jpg',
                            description: 'Main product image URL. Must be a direct link to a jpg/png/webp file.' },
                        { displayName: 'Include Tax in Price', name: 'with_tax', type: 'boolean', default: true },
                        { displayName: 'Max Donation Amount', name: 'max_amount_donating', type: 'number', default: 0,
                            description: 'For donation-type products only' },
                        { displayName: 'Min Donation Amount', name: 'min_amount_donating', type: 'number', default: 0,
                            description: 'For donation-type products only' },
                        { displayName: 'MPN (Manufacturer Part Number)', name: 'mpn', type: 'string', default: '',
                            placeholder: 'MPN-12345',
                            description: 'Manufacturer Part Number for product identification' },
                        { displayName: 'Promotion Subtitle', name: 'promotion_sub_title', type: 'string', default: '',
                            placeholder: 'Collection 2026',
                            description: 'Secondary badge text, e.g. "Collection 2026"' },
                        { displayName: 'Promotion Title', name: 'promotion_title', type: 'string', default: '',
                            placeholder: 'New',
                            description: 'Badge text shown on product, e.g. "New" or "Best Seller"' },
                        { displayName: 'Sale End Date', name: 'sale_end', type: 'string', default: '',
                            description: 'Format: YYYY-MM-DD. When the sale price expires.' },
                        { displayName: 'SEO Description', name: 'metadata_description', type: 'string', default: '',
                            description: 'Description for search engines. Keep under 160 characters.' },
                        { displayName: 'SEO Title', name: 'metadata_title', type: 'string', default: '',
                            description: 'Title for search engines. If empty, product name is used.' },
                        { displayName: 'SEO URL Slug', name: 'metadata_url', type: 'string', default: '',
                            placeholder: 'my-product-name',
                            description: 'Custom URL slug. Only lowercase letters, numbers, and hyphens.' },
                        { displayName: 'Status', name: 'status', type: 'options', default: 'sale',
                            options: [
                                { name: 'Sale (Active)', value: 'sale' },
                                { name: 'Hidden', value: 'hidden' },
                                { name: 'Out of Stock', value: 'out' },
                            ] },
                        { displayName: 'Weight', name: 'weight', type: 'number', default: 0 },
                        { displayName: 'Weight Type', name: 'weight_type', type: 'options', default: 'kg',
                            options: [
                                { name: 'Kilogram', value: 'kg' },
                                { name: 'Gram', value: 'g' },
                                { name: 'Pound', value: 'lb' },
                                { name: 'Ounce', value: 'oz' },
                            ] },
                    ] },
                // ═══════════════════════════════════════════
                //  PRODUCT: Update Fields
                // ═══════════════════════════════════════════
                { displayName: 'Update Fields', name: 'productUpdateFields', type: 'collection', placeholder: 'Add Field', default: {},
                    displayOptions: { show: { resource: ['product'], operation: ['update'], useCustomJson: [false] } },
                    options: [
                        { displayName: 'Brand Name or ID', name: 'brand_id', type: 'options', default: '',
                            typeOptions: { loadOptionsMethod: 'getBrands' },
                            description: 'Select a brand for this product. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        { displayName: 'Category Names or IDs', name: 'categories', type: 'multiOptions', default: [],
                            typeOptions: { loadOptionsMethod: 'getCategories' },
                            description: 'Select one or more categories. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        { displayName: 'Cost Price', name: 'cost_price', type: 'number', default: 0 },
                        { displayName: 'Description', name: 'description', type: 'string', default: '',
                            description: 'Product description. Supports HTML tags.' },
                        { displayName: 'GTIN', name: 'gtin', type: 'string', default: '',
                            placeholder: '0123456789012' },
                        { displayName: 'Include Tax in Price', name: 'with_tax', type: 'boolean', default: true },
                        { displayName: 'MPN', name: 'mpn', type: 'string', default: '',
                            placeholder: 'MPN-12345' },
                        { displayName: 'Name', name: 'name', type: 'string', default: '',
                            description: 'New product name' },
                        { displayName: 'Price', name: 'price', type: 'number', default: 0,
                            description: 'New price in store currency' },
                        { displayName: 'Promotion Subtitle', name: 'promotion_sub_title', type: 'string', default: '',
                            placeholder: 'Collection 2026' },
                        { displayName: 'Promotion Title', name: 'promotion_title', type: 'string', default: '',
                            placeholder: 'New' },
                        { displayName: 'Quantity', name: 'quantity', type: 'number', default: 0,
                            description: 'New stock quantity' },
                        { displayName: 'Requires Shipping', name: 'require_shipping', type: 'boolean', default: true },
                        { displayName: 'Sale End Date', name: 'sale_end', type: 'string', default: '',
                            description: 'Format: YYYY-MM-DD' },
                        { displayName: 'Sale Price', name: 'sale_price', type: 'number', default: 0,
                            description: 'Discounted price. 0 to remove discount.' },
                        { displayName: 'SEO Description', name: 'metadata_description', type: 'string', default: '',
                            description: 'Keep under 160 characters' },
                        { displayName: 'SEO Title', name: 'metadata_title', type: 'string', default: '',
                            description: 'Title for search engines' },
                        { displayName: 'SEO URL Slug', name: 'metadata_url', type: 'string', default: '',
                            placeholder: 'my-product-name' },
                        { displayName: 'SKU', name: 'sku', type: 'string', default: '',
                            placeholder: 'TSHIRT-BLK-XL',
                            description: 'Stock Keeping Unit' },
                        { displayName: 'Status', name: 'status', type: 'options', default: 'sale',
                            options: [
                                { name: 'Sale (Active)', value: 'sale' },
                                { name: 'Hidden', value: 'hidden' },
                                { name: 'Out of Stock', value: 'out' },
                            ] },
                        { displayName: 'Weight', name: 'weight', type: 'number', default: 0 },
                        { displayName: 'Weight Type', name: 'weight_type', type: 'options', default: 'kg',
                            options: [
                                { name: 'Kilogram', value: 'kg' },
                                { name: 'Gram', value: 'g' },
                                { name: 'Pound', value: 'lb' },
                                { name: 'Ounce', value: 'oz' },
                            ] },
                    ] },
                // ═══════════════════════════════════════════
                //  PRODUCT: Attach Image
                // ═══════════════════════════════════════════
                { displayName: 'Image URL', name: 'imageUrl', type: 'string', required: true, default: '',
                    displayOptions: { show: { resource: ['product'], operation: ['attachImage'] } },
                    placeholder: 'https://example.com/image.jpg',
                    description: 'Public direct URL of a JPG, PNG, GIF, or WebP image. SallaFlow downloads it safely and uploads it to Salla.' },
                { displayName: 'Set as Main Image', name: 'imageMain', type: 'boolean', default: false,
                    displayOptions: { show: { resource: ['product'], operation: ['attachImage'] } },
                    description: 'Whether to make this the main product image' },
                { displayName: 'Image Alt Text', name: 'imageAlt', type: 'string', default: '',
                    displayOptions: { show: { resource: ['product'], operation: ['attachImage'] } },
                    placeholder: 'Product photo description',
                    description: 'Alt text for SEO and accessibility' },
                { displayName: 'Sort Order', name: 'imageSort', type: 'number', typeOptions: { minValue: 0 }, default: 1,
                    displayOptions: { show: { resource: ['product'], operation: ['attachImage'] } },
                    description: 'Position in the image gallery. 0 = first.' },
                // ═══════════════════════════════════════════
                //  PRODUCT OPTION: Product + Option IDs
                // ═══════════════════════════════════════════
                { displayName: 'Product Name or ID', name: 'productId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getProducts' },
                    displayOptions: { show: { resource: ['productOption'] } },
                    description: 'Pick the product the option belongs to. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Option Name or ID', name: 'optionId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getOptionsForSelectedProduct', loadOptionsDependsOn: ['productId'] },
                    displayOptions: { show: { resource: ['productOption'], operation: ['get'] } },
                    description: 'Pick the option on the selected product. Change the product first, then open this dropdown to refresh. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Option Name or ID', name: 'optionId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getOptionsForSelectedProduct', loadOptionsDependsOn: ['productId'] },
                    displayOptions: { show: { resource: ['productOption'], operation: ['delete'], deleteUseJson: [false] } },
                    description: 'Pick the option to delete. Hidden when "Use Custom JSON" is on. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Use Advanced JSON', name: 'deleteUseJson', type: 'boolean', default: false,
                    displayOptions: { show: { resource: ['productOption'], operation: ['delete'] } },
                    description: 'Whether to delete many options at once using a JSON array of IDs. Leave off to delete one option using the dropdown.' },
                { displayName: 'Option IDs JSON', name: 'deleteJsonBody', type: 'json', default: '[]',
                    displayOptions: { show: { resource: ['productOption'], operation: ['delete'], deleteUseJson: [true] } },
                    description: 'Array of option IDs to delete. Accepts numeric IDs or option objects. Example: [123, 456, 789].' },
                { displayName: 'Option Name or ID', name: 'optionId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getOptionsForSelectedProduct', loadOptionsDependsOn: ['productId'] },
                    displayOptions: { show: { resource: ['productOption'], operation: ['update'], optionUseJson: [false] } },
                    description: 'Pick the option to update. Hidden when "Use Custom JSON" is on — in JSON mode each entry carries its own "ID". Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Option Name or ID', name: 'optionId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getOptionsForSelectedProduct', loadOptionsDependsOn: ['productId'] },
                    displayOptions: { show: { resource: ['productOption'], operation: ['updateValue'] } },
                    description: 'Pick the option that owns the value. Needed to populate the Value dropdown below. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Use Advanced JSON', name: 'valueUseJson', type: 'boolean', default: false,
                    displayOptions: { show: { resource: ['productOption'], operation: ['updateValue'] } },
                    description: 'Whether to send a JSON body (one object or an array for bulk editing) instead of using the form fields' },
                { displayName: 'Value Name or ID', name: 'optionValueId', type: 'options', required: true, default: '',
                    typeOptions: { loadOptionsMethod: 'getValuesForSelectedOption', loadOptionsDependsOn: ['productId', 'optionId'] },
                    displayOptions: { show: { resource: ['productOption'], operation: ['updateValue'], valueUseJson: [false] } },
                    description: 'Pick which value to edit. Change the option first, then reopen this dropdown. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                { displayName: 'Value JSON (Object or Array)', name: 'valueJsonBody', type: 'json', default: '[]',
                    displayOptions: { show: { resource: ['productOption'], operation: ['updateValue'], valueUseJson: [true] } },
                    description: 'Single object or array of objects. Each object must include its value ID. Any of name, price, display_value, is_default can be set — omitted fields are preserved. Use Product Variant for SKU stock.' },
                { displayName: 'New Name', name: 'updateValueName', type: 'string', default: '',
                    displayOptions: { show: { resource: ['productOption'], operation: ['updateValue'], valueUseJson: [false] } },
                    placeholder: 'Leave blank to keep current',
                    description: 'New name for this value. Leave blank to keep current.' },
                { displayName: 'New Price', name: 'updateValuePrice', type: 'string', default: '',
                    displayOptions: { show: { resource: ['productOption'], operation: ['updateValue'], valueUseJson: [false] } },
                    placeholder: 'Leave blank to keep current (e.g. 10 or 0)',
                    description: 'New additional-price for this value. Enter a number, or leave blank to keep current. Enter 0 to set no extra price.' },
                { displayName: 'New Display Value', name: 'updateValueDisplayValue', type: 'string', default: '',
                    displayOptions: { show: { resource: ['productOption'], operation: ['updateValue'], valueUseJson: [false] } },
                    placeholder: 'Leave blank to keep current (e.g. #FF0000 or image ID)',
                    description: 'New display value (color hex or image ID). Leave blank to keep current.' },
                { displayName: 'Is Default', name: 'updateValueIsDefault', type: 'options', default: '',
                    displayOptions: { show: { resource: ['productOption'], operation: ['updateValue'], valueUseJson: [false] } },
                    options: [
                        { name: '— Keep Current —', value: '' },
                        { name: 'Yes', value: 'true' },
                        { name: 'No', value: 'false' },
                    ] },
                // ═══════════════════════════════════════════
                //  PRODUCT OPTION: Create / Update form
                // ═══════════════════════════════════════════
                { displayName: 'Use Advanced JSON', name: 'optionUseJson', type: 'boolean', default: false,
                    displayOptions: { show: { resource: ['productOption'], operation: ['create', 'update'] } },
                    description: 'Whether to send a raw JSON body instead of using the form fields below' },
                { displayName: 'Options JSON (Array)', name: 'optionJsonBodyCreate', type: 'json', default: '[]',
                    displayOptions: { show: { resource: ['productOption'], operation: ['create'], optionUseJson: [true] } },
                    description: 'JSON array of options. Example: [{"name":"Size","type":"radio","purpose":"variants","required":true,"values":[{"name":"S","price":0},{"name":"M","price":10}]}].' },
                { displayName: 'Option JSON (Object or Array)', name: 'optionJsonBodyUpdate', type: 'json', default: '{}',
                    displayOptions: { show: { resource: ['productOption'], operation: ['update'], optionUseJson: [true] } },
                    description: 'JSON for the updated option(s). A single object updates the option picked above. An array updates many options, and each entry must include its option ID. Each bulk entry uses its own safe read-merge-update request.' },
                { displayName: 'Options', name: 'optionsList', type: 'fixedCollection', default: {},
                    typeOptions: { multipleValues: true },
                    displayOptions: { show: { resource: ['productOption'], operation: ['create'], optionUseJson: [false] } },
                    description: 'Add one or more options to the product',
                    options: [{
                        name: 'option',
                        displayName: 'Option',
                        values: [
																			{
																				displayName: 'Description',
																				name: 'description',
																				type: 'string',
																				default: '',
																				placeholder: 'e.g. Pick the size that fits you best',
																				description: 'Helper text shown under the option label on the storefront. Optional.',
																			},
																			{
																				displayName: 'Display Type',
																				name: 'display_type',
																				type: 'options',
																				default: 'text',
																				options: [
																							{
																								name: 'Text',
																								value: 'text',
																							},
																							{
																								name: 'Color Swatch',
																								value: 'color',
																							},
																							{
																								name: 'Image',
																								value: 'image',
																							},
																						],
																				description: 'How option values are displayed to the customer',
																			},
																			{
																				displayName: 'Option Name',
																				name: 'name',
																				type: 'string',
																					required:	true,
																				default: '',
																				placeholder: 'Size',
																				description: 'Name of the option, e.g. Size, Color, Email',
																			},
																			{
																				displayName: 'Purpose',
																				name: 'purpose',
																				type: 'options',
																				default: 'variants',
																				options: [
																							{
																								name: 'Variants (Size, Color, etc.)',
																								value: 'variants',
																							},
																							{
																								name: 'Form Input (Email, Notes, etc.)',
																								value: 'form',
																							},
																					],
																				description: 'Variants	=	customer picks from values. Form	=	customer types input.',
																			},
																			{
																				displayName: 'Required',
																				name: 'required',
																				type: 'boolean',
																				default: false,
																				description: 'Whether the customer must select this option',
																			},
																			{
																				displayName: 'Type',
																				name: 'type',
																				type: 'options',
																				default: 'radio',
																				options: [
																							{
																								name: 'Checkbox (Multi Choice)',
																								value: 'checkbox',
																							},
																							{
																								name: 'Color Picker',
																								value: 'color_picker',
																							},
																							{
																								name: 'Date',
																								value: 'date',
																							},
																							{
																								name: 'Date	&	Time',
																								value: 'datetime',
																							},
																							{
																								name: 'File Upload',
																								value: 'file',
																							},
																							{
																								name: 'Image Upload',
																								value: 'image',
																							},
																							{
																								name: 'Map',
																								value: 'map',
																							},
																							{
																								name: 'Number',
																								value: 'number',
																							},
																							{
																								name: 'Radio (Single Choice)',
																								value: 'radio',
																							},
																							{
																								name: 'Splitter (Section Divider)',
																								value: 'splitter',
																							},
																							{
																								name: 'Text (Customer Types Input)',
																								value: 'text',
																							},
																							{
																								name: 'Text Area',
																								value: 'textarea',
																							},
																							{
																								name: 'Time',
																								value: 'time',
																							},
																					]
																			},
																			{
																				displayName: 'Values',
																				name: 'values',
																				type: 'fixedCollection',
																				default: {},
																				description: 'Choices for this option (e.g. S, M, L). Only needed for Variants.',
																				options: [
																							{
																								name: 'value',
																								displayName: 'Value',
																									values:	[
																									{
																										displayName: 'Value Name',
																										name: 'name',
																										type: 'string',
																											required:	true,
																										default: '',
																										placeholder: 'e.g. Small',
																									},
																									{
																										displayName: 'Additional Price',
																										name: 'price',
																										type: 'number',
																										default: 0,
																										description: 'Extra charge (0	=	no extra). Requires advance pricing in Salla store settings.',
																									},
																									{
																										displayName: 'Display Value',
																										name: 'display_value',
																										type: 'string',
																										default: '',
																										placeholder: '#FF0000 or image ID',
																									},
																									{
																										displayName: 'Is Default',
																										name: 'is_default',
																										type: 'boolean',
																										default: false,
																									},
																									]
																							},
																					]
																			},
																			],
                    }] },
                // Update uses a flat single-option form (Salla PUT replaces one option at a time)
                { displayName: 'Option Name', name: 'updateOptionName', type: 'string', default: '',
                    displayOptions: { show: { resource: ['productOption'], operation: ['update'], optionUseJson: [false] } },
                    placeholder: 'Size',
                    description: 'New option name. Leave blank to keep current.' },
                { displayName: 'Description', name: 'updateOptionDescription', type: 'string', default: '',
                    displayOptions: { show: { resource: ['productOption'], operation: ['update'], optionUseJson: [false] } },
                    placeholder: 'Leave blank to keep current',
                    description: 'New helper text shown under the option on the storefront. Leave blank to keep current.' },
                { displayName: 'Purpose', name: 'updateOptionPurpose', type: 'options', default: '',
                    displayOptions: { show: { resource: ['productOption'], operation: ['update'], optionUseJson: [false] } },
                    options: [
                        { name: '— Keep Current —', value: '' },
                        { name: 'Variants (Size, Color, etc.)', value: 'variants' },
                        { name: 'Form Input (Email, Notes, etc.)', value: 'form' },
                    ] },
                { displayName: 'Type', name: 'updateOptionType', type: 'options', default: '',
                    displayOptions: { show: { resource: ['productOption'], operation: ['update'], optionUseJson: [false] } },
                    options: [
                        { name: '— Keep Current —', value: '' },
                        { name: 'Checkbox', value: 'checkbox' },
                        { name: 'Color Picker', value: 'color_picker' },
                        { name: 'Date', value: 'date' },
                        { name: 'Date & Time', value: 'datetime' },
                        { name: 'File Upload', value: 'file' },
                        { name: 'Image Upload', value: 'image' },
                        { name: 'Map', value: 'map' },
                        { name: 'Number', value: 'number' },
                        { name: 'Radio', value: 'radio' },
                        { name: 'Splitter', value: 'splitter' },
                        { name: 'Text', value: 'text' },
                        { name: 'Text Area', value: 'textarea' },
                        { name: 'Time', value: 'time' },
                    ] },
                { displayName: 'Display Type', name: 'updateOptionDisplayType', type: 'options', default: '',
                    displayOptions: { show: { resource: ['productOption'], operation: ['update'], optionUseJson: [false] } },
                    options: [
                        { name: '— Keep Current —', value: '' },
                        { name: 'Text', value: 'text' },
                        { name: 'Color Swatch', value: 'color' },
                        { name: 'Image', value: 'image' },
                    ] },
                { displayName: 'Required', name: 'updateOptionRequired', type: 'options', default: '',
                    displayOptions: { show: { resource: ['productOption'], operation: ['update'], optionUseJson: [false] } },
                    options: [
                        { name: '— Keep Current —', value: '' },
                        { name: 'Yes', value: 'true' },
                        { name: 'No', value: 'false' },
                    ] },
                { displayName: 'Replace Values', name: 'updateOptionReplaceValues', type: 'boolean', default: false,
                    displayOptions: { show: { resource: ['productOption'], operation: ['update'], optionUseJson: [false] } },
                    description: 'Whether to replace all values on this option with the list below. Leave off to keep existing values untouched.' },
                { displayName: 'Values', name: 'updateOptionValues', type: 'fixedCollection', default: {},
                    typeOptions: { multipleValues: true },
                    displayOptions: { show: { resource: ['productOption'], operation: ['update'], optionUseJson: [false], updateOptionReplaceValues: [true] } },
                    description: 'Full replacement set of values for this option. Existing values NOT listed here will be removed.',
                    options: [{
                        name: 'value',
                        displayName: 'Value',
                        values: [
                            { displayName: 'Value Name', name: 'name', type: 'string', required: true, default: '',
                                placeholder: 'e.g. Small' },
                            { displayName: 'Additional Price', name: 'price', type: 'number', default: 0 },
                            { displayName: 'Display Value', name: 'display_value', type: 'string', default: '',
                                placeholder: '#FF0000 or image ID' },
                            { displayName: 'Is Default', name: 'is_default', type: 'boolean', default: false },
                        ],
                    }] },
                // ═══════════════════════════════════════════
                //  PRODUCT: Update Quantity
                // ═══════════════════════════════════════════
                { displayName: 'Quantity', name: 'quantityValue', type: 'number', required: true, default: 0,
                    displayOptions: { show: { resource: ['product'], operation: ['updateQuantity'] } },
                    description: 'New stock quantity for this product' },
                { displayName: 'Unlimited Quantity', name: 'unlimitedQuantity', type: 'boolean', default: false,
                    displayOptions: { show: { resource: ['product'], operation: ['updateQuantity'] } },
                    description: 'Whether to set the product to unlimited stock and ignore the quantity value' },
                // ═══════════════════════════════════════════
                //  PRODUCT: Bulk Inventory Update
                // ═══════════════════════════════════════════
                { displayName: 'Use Advanced JSON', name: 'inventoryUseJson', type: 'boolean', default: false,
                    displayOptions: { show: { resource: ['product'], operation: ['updateInventoryBulk'] } },
                    description: 'Whether to provide expressions or a full products array as JSON instead of using the fields below' },
                { displayName: 'Inventory Items', name: 'inventoryItems', type: 'fixedCollection', default: {},
                    typeOptions: { multipleValues: true },
                    displayOptions: { show: { resource: ['product'], operation: ['updateInventoryBulk'], inventoryUseJson: [false] } },
                    description: 'Add each product, SKU, or variant quantity adjustment. Increment/decrement is safer than overwrite when other systems also change stock.',
                    options: [{
                        name: 'item',
                        displayName: 'Item',
                        values: [
																			{
																				displayName: 'Branch ID',
																				name: 'branch',
																				type: 'string',
																				default: '',
																				description: 'Optional branch whose inventory should be adjusted',
																			},
																			{
																				displayName: 'Identifier',
																				name: 'identifier',
																				type: 'string',
																					required:	true,
																				default: '',
																				placeholder: 'Product ID, SKU, or variant ID',
																			},
																			{
																				displayName: 'Identifier Type',
																				name: 'identifierType',
																				type: 'options',
																				default: 'id',
																				options: [
																							{
																								name: 'Product ID',
																								value: 'id',
																							},
																							{
																								name: 'Product SKU',
																								value: 'sku',
																							},
																							{
																								name: 'Variant ID',
																								value: 'variant_id',
																							},
																						]
																			},
																			{
																				displayName: 'Mode',
																				name: 'mode',
																				type: 'options',
																				default: 'increment',
																				options: [
																							{
																								name: 'Increment (Recommended for Restocking)',
																								value: 'increment',
																							},
																							{
																								name: 'Decrement (Recommended for Adjustments)',
																								value: 'decrement',
																							},
																							{
																								name: 'Overwrite (Use with Caution)',
																								value: 'overwrite',
																							},
																					]
																			},
																			{
																				displayName: 'Quantity',
																				name: 'quantity',
																				type: 'number',
																					required:	true,
																				default: 1
																			},
																			{
																				displayName: 'Reason ID',
																				name: 'reason_id',
																				type: 'string',
																				default: '',
																				description: 'Optional quantity-change reason ID from Salla',
																			},
																			{
																				displayName: 'Unlimited Quantity',
																				name: 'unlimited_quantity',
																				type: 'options',
																				default: '',
																				options: [
																							{
																								name: '—	Do Not Change	—',
																								value: '',
																							},
																							{
																								name: 'Enable',
																								value: 'true',
																							},
																							{
																								name: 'Disable',
																								value: 'false',
																							},
																					]
																			},
																			],
                    }] },
                { displayName: 'Inventory JSON', name: 'inventoryJsonBody', type: 'json', default: '{\n  "products": [\n    {\n      "identifier_type": "id",\n      "identifier": "123456789",\n      "quantity": 5,\n      "mode": "increment"\n    }\n  ]\n}',
                    displayOptions: { show: { resource: ['product'], operation: ['updateInventoryBulk'], inventoryUseJson: [true] } },
                    description: 'Object with products[], or a raw array. Correctly-spelled identifier_type/identifier aliases are accepted and normalized to Salla’s documented identifer_type/identifer keys.' },
                // ═══════════════════════════════════════════
                //  PRODUCT VARIANT
                // ═══════════════════════════════════════════
                { displayName: 'Use Advanced JSON', name: 'variantUseJson', type: 'boolean', default: false,
                    displayOptions: { show: { resource: ['productVariant'], operation: ['update'] } },
                    description: 'Whether to send a custom variant update body as JSON instead of using the fields below' },
                { displayName: 'Update Fields', name: 'variantUpdateFields', type: 'collection', placeholder: 'Add Field', default: {},
                    displayOptions: { show: { resource: ['productVariant'], operation: ['update'], variantUseJson: [false] } },
                    options: [
                        { displayName: 'Barcode', name: 'barcode', type: 'string', default: '' },
                        { displayName: 'Cost Price', name: 'cost_price', type: 'number', default: 0 },
                        { displayName: 'GTIN', name: 'gtin', type: 'string', default: '' },
                        { displayName: 'MPN', name: 'mpn', type: 'string', default: '' },
                        { displayName: 'Price', name: 'price', type: 'number', default: 0 },
                        { displayName: 'Sale Price', name: 'sale_price', type: 'number', default: 0 },
                        { displayName: 'SKU', name: 'sku', type: 'string', default: '' },
                        { displayName: 'Stock Quantity', name: 'stock_quantity', type: 'number', typeOptions: { minValue: 0 }, default: 0,
                            description: 'Absolute stock value. For concurrency-safe adjustments, use Update Quantity instead.' },
                        { displayName: 'Weight', name: 'weight', type: 'number', typeOptions: { minValue: 0 }, default: 0 },
                    ] },
                { displayName: 'Branch Quantities', name: 'variantBranchQuantities', type: 'fixedCollection', default: {},
                    typeOptions: { multipleValues: true },
                    displayOptions: { show: { resource: ['productVariant'], operation: ['update'], variantUseJson: [false] } },
                    description: 'Optional absolute quantities for one or more branches',
                    options: [{
                        name: 'quantity',
                        displayName: 'Branch Quantity',
                        values: [
                            { displayName: 'Branch ID', name: 'branch', type: 'string', required: true, default: '' },
                            { displayName: 'Quantity', name: 'quantity', type: 'number', required: true, typeOptions: { minValue: 0 }, default: 0 },
                            { displayName: 'Reason ID', name: 'reason_id', type: 'string', default: '' },
                        ],
                    }] },
                { displayName: 'Variant JSON', name: 'variantJsonBody', type: 'json', default: '{}',
                    displayOptions: { show: { resource: ['productVariant'], operation: ['update'], variantUseJson: [true] } },
                    description: 'At least one update field is required. Supported fields include sku, barcode, price, sale_price, cost_price, stock_quantity, weight, mpn, gtin, and quantities.' },
                { displayName: 'Use Advanced JSON', name: 'variantQuantityUseJson', type: 'boolean', default: false,
                    displayOptions: { show: { resource: ['productVariant'], operation: ['updateQuantity'] } },
                    description: 'Whether to provide quantity, mode, branch, reason_id, and unlimited_quantity as advanced JSON' },
                { displayName: 'Quantity', name: 'variantQuantity', type: 'number', required: true, typeOptions: { minValue: 0 }, default: 1,
                    displayOptions: { show: { resource: ['productVariant'], operation: ['updateQuantity'], variantQuantityUseJson: [false] } } },
                { displayName: 'Mode', name: 'variantQuantityMode', type: 'options', default: 'increment',
                    displayOptions: { show: { resource: ['productVariant'], operation: ['updateQuantity'], variantQuantityUseJson: [false] } },
                    options: [
                        { name: 'Increment (Recommended for Restocking)', value: 'increment' },
                        { name: 'Decrement (Recommended for Adjustments)', value: 'decrement' },
                        { name: 'Overwrite (Use with Caution)', value: 'overwrite' },
                    ] },
                { displayName: 'Additional Fields', name: 'variantQuantityAdditionalFields', type: 'collection', placeholder: 'Add Field', default: {},
                    displayOptions: { show: { resource: ['productVariant'], operation: ['updateQuantity'], variantQuantityUseJson: [false] } },
                    options: [
                        { displayName: 'Branch ID', name: 'branch', type: 'string', default: '' },
                        { displayName: 'Reason ID', name: 'reason_id', type: 'string', default: '' },
                        { displayName: 'Unlimited Quantity', name: 'unlimited_quantity', type: 'options', default: '',
                            options: [
                                { name: '— Do Not Change —', value: '' },
                                { name: 'Enable', value: 'true' },
                                { name: 'Disable', value: 'false' },
                            ] },
                    ] },
                { displayName: 'Quantity JSON', name: 'variantQuantityJsonBody', type: 'json', default: '{\n  "quantity": 1,\n  "mode": "increment"\n}',
                    displayOptions: { show: { resource: ['productVariant'], operation: ['updateQuantity'], variantQuantityUseJson: [true] } },
                    description: 'The selected variant ID is added automatically. Mode must be increment, decrement, or overwrite.' },
                // ═══════════════════════════════════════════
                //  BRAND: Create Fields
                // ═══════════════════════════════════════════
                { displayName: 'Brand Name', name: 'brandName', type: 'string', required: true, default: '',
                    displayOptions: { show: { resource: ['brand'], operation: ['create'], useCustomJson: [false] } },
                    description: 'The brand name, e.g. "Nike" or "Samsung"' },
                { displayName: 'Logo URL', name: 'brandLogo', type: 'string', required: true, default: '',
                    displayOptions: { show: { resource: ['brand'], operation: ['create'], useCustomJson: [false] } },
                    placeholder: 'https://example.com/logo.png',
                    description: 'Brand logo image URL (required). Must be a direct link to an image file (jpg/png/webp/gif).' },
                { displayName: 'Additional Fields', name: 'brandAdditionalFields', type: 'collection', placeholder: 'Add Field', default: {},
                    displayOptions: { show: { resource: ['brand'], operation: ['create'], useCustomJson: [false] } },
                    options: [
                        { displayName: 'Banner Image URL', name: 'banner', type: 'string', default: '',
                            placeholder: 'https://example.com/banner.jpg',
                            description: 'Brand banner image URL (displayed on brand page)' },
                        { displayName: 'Description', name: 'description', type: 'string', typeOptions: { rows: 3 }, default: '',
                            description: 'Brand description. Supports HTML.' },
                        { displayName: 'SEO Description', name: 'metadata_description', type: 'string', default: '',
                            description: 'Description for search engines' },
                        { displayName: 'SEO Title', name: 'metadata_title', type: 'string', default: '',
                            description: 'Title for search engines' },
                        { displayName: 'SEO URL Slug', name: 'metadata_url', type: 'string', default: '',
                            placeholder: 'nike-brand',
                            description: 'Custom URL slug for this brand' },
                        { displayName: 'Status', name: 'status', type: 'options', default: 'active',
                            options: [
                                { name: 'Active', value: 'active' },
                                { name: 'Hidden', value: 'hidden' },
                            ] },
                    ] },
                // ═══════════════════════════════════════════
                //  BRAND: Update Fields
                // ═══════════════════════════════════════════
                { displayName: 'Update Fields', name: 'brandUpdateFields', type: 'collection', placeholder: 'Add Field', default: {},
                    displayOptions: { show: { resource: ['brand'], operation: ['update'], useCustomJson: [false] } },
                    options: [
                        { displayName: 'Banner Image URL', name: 'banner', type: 'string', default: '',
                            placeholder: 'https://example.com/banner.jpg',
                            description: 'Brand banner image URL' },
                        { displayName: 'Description', name: 'description', type: 'string', typeOptions: { rows: 3 }, default: '',
                            description: 'Brand description. Supports HTML.' },
                        { displayName: 'Logo URL', name: 'logo_url', type: 'string', default: '',
                            placeholder: 'https://example.com/logo.png',
                            description: 'Brand logo image URL. Must be a direct link to an image file.' },
                        { displayName: 'Name', name: 'name', type: 'string', default: '',
                            description: 'New brand name' },
                        { displayName: 'SEO Description', name: 'metadata_description', type: 'string', default: '',
                            description: 'Description for search engines' },
                        { displayName: 'SEO Title', name: 'metadata_title', type: 'string', default: '',
                            description: 'Title for search engines' },
                        { displayName: 'SEO URL Slug', name: 'metadata_url', type: 'string', default: '',
                            placeholder: 'nike-brand',
                            description: 'Custom URL slug for this brand' },
                        { displayName: 'Status', name: 'status', type: 'options', default: 'active',
                            options: [
                                { name: 'Active', value: 'active' },
                                { name: 'Hidden', value: 'hidden' },
                            ] },
                    ] },
                // ═══════════════════════════════════════════
                //  CATEGORY: Create Fields
                // ═══════════════════════════════════════════
                { displayName: 'Category Name', name: 'categoryName', type: 'string', required: true, default: '',
                    displayOptions: { show: { resource: ['category'], operation: ['create'], useCustomJson: [false] } },
                    description: 'The category name, e.g. "Electronics" or "Clothing"' },
                { displayName: 'Additional Fields', name: 'categoryAdditionalFields', type: 'collection', placeholder: 'Add Field', default: {},
                    displayOptions: { show: { resource: ['category'], operation: ['create'], useCustomJson: [false] } },
                    options: [
                        { displayName: 'Image URL', name: 'image', type: 'string', default: '',
                            placeholder: 'https://example.com/category.jpg',
                            description: 'Category image URL' },
                        { displayName: 'Parent Category Name or ID', name: 'parent_id', type: 'options', default: '',
                            typeOptions: { loadOptionsMethod: 'getCategories' },
                            description: 'Select a parent category to make this a sub-category. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        { displayName: 'SEO Description', name: 'metadata_description', type: 'string', default: '',
                            description: 'Description for search engines' },
                        { displayName: 'SEO Title', name: 'metadata_title', type: 'string', default: '',
                            description: 'Title for search engines' },
                        { displayName: 'SEO URL Slug', name: 'metadata_url', type: 'string', default: '',
                            placeholder: 'electronics',
                            description: 'Custom URL slug for this category' },
                        { displayName: 'Status', name: 'status', type: 'options', default: 'active',
                            options: [
                                { name: 'Active', value: 'active' },
                                { name: 'Hidden', value: 'hidden' },
                            ] },
                    ] },
                // ═══════════════════════════════════════════
                //  CATEGORY: Update Fields
                // ═══════════════════════════════════════════
                { displayName: 'Update Fields', name: 'categoryUpdateFields', type: 'collection', placeholder: 'Add Field', default: {},
                    displayOptions: { show: { resource: ['category'], operation: ['update'], useCustomJson: [false] } },
                    options: [
                        { displayName: 'Image URL', name: 'image', type: 'string', default: '',
                            placeholder: 'https://example.com/category.jpg',
                            description: 'Category image URL' },
                        { displayName: 'Name', name: 'name', type: 'string', default: '',
                            description: 'New category name' },
                        { displayName: 'SEO Description', name: 'metadata_description', type: 'string', default: '',
                            description: 'Description for search engines' },
                        { displayName: 'SEO Title', name: 'metadata_title', type: 'string', default: '',
                            description: 'Title for search engines' },
                        { displayName: 'SEO URL Slug', name: 'metadata_url', type: 'string', default: '',
                            placeholder: 'electronics',
                            description: 'Custom URL slug for this category' },
                        { displayName: 'Status', name: 'status', type: 'options', default: 'active',
                            options: [
                                { name: 'Active', value: 'active' },
                                { name: 'Hidden', value: 'hidden' },
                            ] },
                    ] },
                // ═══════════════════════════════════════════
                //  CUSTOMER: Create Fields
                // ═══════════════════════════════════════════
                { displayName: 'First Name', name: 'customerFirstName', type: 'string', required: true, default: '',
                    displayOptions: { show: { resource: ['customer'], operation: ['create'], useCustomJson: [false] } },
                    description: 'Customer first name' },
                { displayName: 'Last Name', name: 'customerLastName', type: 'string', default: '',
                    displayOptions: { show: { resource: ['customer'], operation: ['create'], useCustomJson: [false] } },
                    description: 'Customer last name (optional)' },
                { displayName: 'Mobile', name: 'customerMobile', type: 'string', required: true, default: '',
                    displayOptions: { show: { resource: ['customer'], operation: ['create'], useCustomJson: [false] } },
                    placeholder: '555555555',
                    description: 'Phone number without country code, e.g. 555555555' },
                { displayName: 'Email', name: 'customerEmail', type: 'string', default: '',
                    displayOptions: { show: { resource: ['customer'], operation: ['create'], useCustomJson: [false] } },
                    placeholder: 'customer@example.com',
                    description: 'Customer email address (optional)' },
                { displayName: 'Mobile Country Code', name: 'customerCountryCode', type: 'string', default: '+966',
                    displayOptions: { show: { resource: ['customer'], operation: ['create'], useCustomJson: [false] } },
                    placeholder: '+966',
                    description: 'Country dialing code with + prefix. +966 Saudi, +971 UAE, +20 Egypt, +965 Kuwait.' },
                // ── Customer Create: Additional Fields ──
                { displayName: 'Additional Fields', name: 'customerAdditionalFields', type: 'collection', placeholder: 'Add Field', default: {},
                    displayOptions: { show: { resource: ['customer'], operation: ['create'], useCustomJson: [false] } },
                    options: [
                        { displayName: 'Gender', name: 'gender', type: 'options', default: 'male',
                            options: [{ name: 'Male', value: 'male' }, { name: 'Female', value: 'female' }] },
                        { displayName: 'Birthday', name: 'birthday', type: 'string', default: '',
                            placeholder: '1990-01-15',
                            description: 'Format: YYYY-MM-DD' },
                        { displayName: 'Groups (Comma-Separated IDs)', name: 'groups', type: 'string', default: '',
                            placeholder: '123,456',
                            description: 'Customer group IDs separated by commas' },
                    ] },
                // ═══════════════════════════════════════════
                //  CUSTOMER: Update Fields
                // ═══════════════════════════════════════════
                { displayName: 'Update Fields', name: 'customerUpdateFields', type: 'collection', placeholder: 'Add Field', default: {},
                    displayOptions: { show: { resource: ['customer'], operation: ['update'], useCustomJson: [false] } },
                    options: [
                        { displayName: 'Birthday', name: 'birthday', type: 'string', default: '',
                            placeholder: '1990-01-15',
                            description: 'Format: YYYY-MM-DD' },
                        { displayName: 'Email', name: 'email', type: 'string', default: '',
                            placeholder: 'customer@example.com' },
                        { displayName: 'First Name', name: 'first_name', type: 'string', default: '' },
                        { displayName: 'Gender', name: 'gender', type: 'options', default: 'male',
                            options: [{ name: 'Male', value: 'male' }, { name: 'Female', value: 'female' }] },
                        { displayName: 'Groups (Comma-Separated IDs)', name: 'groups', type: 'string', default: '',
                            placeholder: '123,456',
                            description: 'Customer group IDs separated by commas' },
                        { displayName: 'Last Name', name: 'last_name', type: 'string', default: '' },
                        { displayName: 'Mobile', name: 'mobile', type: 'string', default: '',
                            placeholder: '555555555',
                            description: 'Phone number without country code' },
                        { displayName: 'Mobile Country Code', name: 'mobile_code_country', type: 'string', default: '',
                            placeholder: '+966',
                            description: 'Country dialing code with + prefix. +966 Saudi, +971 UAE, +20 Egypt.' },
                    ] },
                // ═══════════════════════════════════════════
                //  COUPON: Create Fields
                // ═══════════════════════════════════════════
                { displayName: 'Coupon Code', name: 'couponCode', type: 'string', required: true, default: '',
                    displayOptions: { show: { resource: ['coupon'], operation: ['create'], useCustomJson: [false] } },
                    placeholder: 'SUMMER2026',
                    description: 'Unique coupon code customers will enter at checkout' },
                { displayName: 'Discount Type', name: 'couponType', type: 'options', required: true, default: 'percentage',
                    displayOptions: { show: { resource: ['coupon'], operation: ['create'], useCustomJson: [false] } },
                    options: [{ name: 'Percentage (%)', value: 'percentage' }, { name: 'Fixed Amount (Store Currency)', value: 'fixed' }] },
                { displayName: 'Discount Amount', name: 'couponAmount', type: 'number', required: true, default: 10,
                    displayOptions: { show: { resource: ['coupon'], operation: ['create'], useCustomJson: [false] } },
                    description: 'Discount value. For percentage: 15 = 15%. For fixed: 50 = 50 units of the store currency.' },
                { displayName: 'Start Date', name: 'couponStartDate', type: 'string', default: '',
                    displayOptions: { show: { resource: ['coupon'], operation: ['create'], useCustomJson: [false] } },
                    placeholder: '2026-01-01',
                    description: 'Format: YYYY-MM-DD. When the coupon becomes active (optional).' },
                { displayName: 'Expiry Date', name: 'couponExpiryDate', type: 'string', required: true, default: '',
                    displayOptions: { show: { resource: ['coupon'], operation: ['create'], useCustomJson: [false] } },
                    placeholder: '2026-12-31',
                    description: 'Format: YYYY-MM-DD. Required by Salla.' },
                { displayName: 'Free Shipping', name: 'couponFreeShipping', type: 'boolean', default: false,
                    displayOptions: { show: { resource: ['coupon'], operation: ['create'], useCustomJson: [false] } } },
                { displayName: 'Maximum Discount Amount', name: 'couponMaxAmount', type: 'number', default: 0,
                    displayOptions: { show: { resource: ['coupon'], operation: ['create'], useCustomJson: [false] } },
                    description: 'Max discount cap. 0 for no limit.' },
                // ── Coupon Create: Additional Fields ──
                { displayName: 'Additional Fields', name: 'couponAdditionalFields', type: 'collection', placeholder: 'Add Field', default: {},
                    displayOptions: { show: { resource: ['coupon'], operation: ['create'], useCustomJson: [false] } },
                    options: [
                        { displayName: 'Applied In', name: 'applied_in', type: 'options', default: 'all',
                            options: [
                                { name: 'All Channels', value: 'all' },
                                { name: 'Browser Only', value: 'browser' },
                                { name: 'App Only', value: 'application' },
                            ] },
                        { displayName: 'Apply With Special Offers', name: 'is_apply_with_offer', type: 'boolean', default: true,
                            description: 'Whether to allow this coupon to stack with active special offers' },
                        { displayName: 'Exclude Brand Names or IDs', name: 'exclude_brands_ids', type: 'multiOptions', default: [],
                            typeOptions: { loadOptionsMethod: 'getBrands' },
                            description: 'Select brands to exclude from this coupon. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        { displayName: 'Exclude Category Names or IDs', name: 'exclude_category_ids', type: 'multiOptions', default: [],
                            typeOptions: { loadOptionsMethod: 'getCategories' },
                            description: 'Select categories excluded from this coupon. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        { displayName: 'Exclude Customer Group IDs', name: 'exclude_customer_group_ids', type: 'string', default: '',
                            description: 'Comma-separated customer group IDs blocked from this coupon' },
                        { displayName: 'Exclude Product Names or IDs', name: 'exclude_product_ids', type: 'multiOptions', default: [],
                            typeOptions: { loadOptionsMethod: 'getProducts' },
                            description: 'Select products excluded from this coupon. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        { displayName: 'Exclude Sale Products', name: 'exclude_sale_products', type: 'boolean', default: false,
                            description: 'Whether to exclude products that are already on sale from this coupon discount' },
                        { displayName: 'Include Category Names or IDs', name: 'include_category_ids', type: 'multiOptions', default: [],
                            typeOptions: { loadOptionsMethod: 'getCategories' },
                            description: 'Select categories this coupon applies to. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        { displayName: 'Include Customer Group IDs', name: 'include_customer_group_ids', type: 'string', default: '',
                            description: 'Comma-separated customer group IDs allowed to use this coupon' },
                        { displayName: 'Include Payment Methods', name: 'include_payment_methods', type: 'multiOptions', default: [],
                            options: [
                                { name: 'Bank Transfer', value: 'bank' },
                                { name: 'Cash on Delivery', value: 'cod' },
                                { name: 'Credit Card', value: 'credit_card' },
                                { name: 'Mada', value: 'mada' },
                                { name: 'STC Pay', value: 'stc_pay' },
                                { name: 'Tabby Installment', value: 'tabby_installment' },
                                { name: 'Tamara Installment', value: 'tamara_installment' },
                            ],
                            description: 'Select payment methods allowed to use this coupon' },
                        { displayName: 'Include Product Names or IDs', name: 'include_product_ids', type: 'multiOptions', default: [],
                            typeOptions: { loadOptionsMethod: 'getProducts' },
                            description: 'Select products this coupon applies to. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        { displayName: 'Minimum Cart Amount', name: 'minimum_amount', type: 'number', default: 0,
                            description: 'Minimum order amount required to use coupon' },
                        { displayName: 'Usage Limit (Total)', name: 'usage_limit', type: 'number', default: 0,
                            description: 'Total number of times this coupon can be used. 0 for unlimited.' },
                        { displayName: 'Usage Limit Per User', name: 'usage_limit_per_user', type: 'number', default: 0,
                            description: 'Max uses per customer. 0 for unlimited.' },
                    ] },
                // ═══════════════════════════════════════════
                //  COUPON: Update Fields
                // ═══════════════════════════════════════════
                { displayName: 'Update Fields', name: 'couponUpdateFields', type: 'collection', placeholder: 'Add Field', default: {},
                    displayOptions: { show: { resource: ['coupon'], operation: ['update'], useCustomJson: [false] } },
                    options: [
                        { displayName: 'Amount', name: 'amount', type: 'number', default: 0,
                            description: 'New discount value' },
                        { displayName: 'Applied In', name: 'applied_in', type: 'options', default: 'all',
                            options: [
                                { name: 'All Channels', value: 'all' },
                                { name: 'Browser Only', value: 'browser' },
                                { name: 'App Only', value: 'application' },
                            ] },
                        { displayName: 'Apply With Special Offers', name: 'is_apply_with_offer', type: 'boolean', default: true,
                            description: 'Whether to allow this coupon to stack with active special offers' },
                        { displayName: 'Code', name: 'code', type: 'string', default: '',
                            placeholder: 'SUMMER2026',
                            description: 'New coupon code' },
                        { displayName: 'Discount Type', name: 'type', type: 'options', default: 'percentage',
                            options: [{ name: 'Percentage (%)', value: 'percentage' }, { name: 'Fixed Amount (Store Currency)', value: 'fixed' }] },
                        { displayName: 'Exclude Brand Names or IDs', name: 'exclude_brands_ids', type: 'multiOptions', default: [],
                            typeOptions: { loadOptionsMethod: 'getBrands' },
                            description: 'Select brands to exclude from this coupon. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        { displayName: 'Exclude Category Names or IDs', name: 'exclude_category_ids', type: 'multiOptions', default: [],
                            typeOptions: { loadOptionsMethod: 'getCategories' },
                            description: 'Select categories excluded from this coupon. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        { displayName: 'Exclude Customer Group IDs', name: 'exclude_customer_group_ids', type: 'string', default: '',
                            placeholder: '789,012',
                            description: 'Comma-separated customer group IDs blocked from this coupon' },
                        { displayName: 'Exclude Product Names or IDs', name: 'exclude_product_ids', type: 'multiOptions', default: [],
                            typeOptions: { loadOptionsMethod: 'getProducts' },
                            description: 'Select products excluded from this coupon. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        { displayName: 'Exclude Sale Products', name: 'exclude_sale_products', type: 'boolean', default: false,
                            description: 'Whether to exclude products that are already on sale from this coupon discount' },
                        { displayName: 'Expiry Date', name: 'expiry_date', type: 'string', default: '',
                            placeholder: '2026-12-31',
                            description: 'Format: YYYY-MM-DD' },
                        { displayName: 'Free Shipping', name: 'free_shipping', type: 'boolean', default: false,
                            description: 'Whether to apply free shipping with this coupon' },
                        { displayName: 'Include Category Names or IDs', name: 'include_category_ids', type: 'multiOptions', default: [],
                            typeOptions: { loadOptionsMethod: 'getCategories' },
                            description: 'Select categories this coupon applies to. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        { displayName: 'Include Customer Group IDs', name: 'include_customer_group_ids', type: 'string', default: '',
                            placeholder: '123,456',
                            description: 'Comma-separated customer group IDs allowed to use this coupon' },
                        { displayName: 'Include Payment Methods', name: 'include_payment_methods', type: 'multiOptions', default: [],
                            options: [
                                { name: 'Bank Transfer', value: 'bank' },
                                { name: 'Cash on Delivery', value: 'cod' },
                                { name: 'Credit Card', value: 'credit_card' },
                                { name: 'Mada', value: 'mada' },
                                { name: 'STC Pay', value: 'stc_pay' },
                                { name: 'Tabby Installment', value: 'tabby_installment' },
                                { name: 'Tamara Installment', value: 'tamara_installment' },
                            ],
                            description: 'Select payment methods allowed to use this coupon' },
                        { displayName: 'Include Product Names or IDs', name: 'include_product_ids', type: 'multiOptions', default: [],
                            typeOptions: { loadOptionsMethod: 'getProducts' },
                            description: 'Select products this coupon applies to. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.' },
                        { displayName: 'Maximum Discount Amount', name: 'maximum_amount', type: 'number', default: 0,
                            description: 'Max discount cap. 0 for no limit.' },
                        { displayName: 'Minimum Cart Amount', name: 'minimum_amount', type: 'number', default: 0,
                            description: 'Minimum order amount to use this coupon' },
                        { displayName: 'Start Date', name: 'start_date', type: 'string', default: '',
                            placeholder: '2026-01-01',
                            description: 'Format: YYYY-MM-DD' },
                        { displayName: 'Usage Limit (Total)', name: 'usage_limit', type: 'number', default: 0,
                            description: '0 for unlimited' },
                        { displayName: 'Usage Limit Per User', name: 'usage_limit_per_user', type: 'number', default: 0,
                            description: '0 for unlimited' },
                    ] },
            ],
    };

    // ═══════════════════════════════════════════════════════════
    //  Dynamic Dropdowns — loadOptions methods
    // ═══════════════════════════════════════════════════════════
    methods: NonNullable<INodeType['methods']> = {
            loadOptions: {
                async getAbandonedCarts() {
                    try {
                        const data = await fetchPaginated(this, 'carts/abandoned');
                        return data.map((cart) => {
                            const customerData = asDataObject(cart.customer ?? {});
                            const cartTotal = asDataObject(cart.total ?? {});
                            const amounts = asDataObject(cart.amounts ?? {});
                            const amountsTotal = asDataObject(amounts.total ?? {});
                            const customer = customerData.full_name
                                || [customerData.first_name, customerData.last_name].filter(Boolean).join(' ')
                                || customerData.mobile
                                || 'Unknown customer';
                            const total = cartTotal.amount ?? amountsTotal.amount;
                            const currency = cartTotal.currency || amountsTotal.currency || cart.currency || 'SAR';
                            return {
                                name: `#${cart.reference_id || cart.id} — ${customer}${total !== undefined ? ` (${total} ${currency})` : ''}`,
                                value: String(cart.id),
                            };
                        });
                    }
                    catch (error) {
                        return [{ name: `⚠ Could not load carts: ${error?.message || 'check the SallaFlow credential and carts.read scope'}`, value: '' }];
                    }
                },
                async getOrders() {
                    try {
                        const data = await fetchPaginated(this, 'orders', 30);
                        return data.map((o) => {
                            const customer = asDataObject(o.customer ?? {});
                            const amounts = asDataObject(o.amounts ?? {});
                            const amountsTotal = asDataObject(amounts.total ?? {});
                            const total = asDataObject(o.total ?? {});
                            return {
                                name: `#${o.reference_id || o.id} — ${customer.full_name || 'N/A'} (${amountsTotal.amount || total.amount || '?'} ${o.currency || amountsTotal.currency || 'SAR'})`,
                                value: String(o.id),
                            };
                        });
                    }
                    catch (error) {
                        return [{ name: `⚠ Could not load orders: ${error?.message || 'check the SallaFlow credential and orders.read scope'}`, value: '' }];
                    }
                },
                async getProducts() {
                    try {
                        const data = await fetchPaginated(this, 'products');
                        return data.map((p) => {
                            const price = asDataObject(p.price ?? {});
                            return {
                                name: `${p.name} (${price.amount || '?'} ${price.currency || 'SAR'})`,
                                value: String(p.id),
                            };
                        });
                    }
                    catch {
                        return [{ name: '⚠ Error Loading Products — Check Credentials', value: '' }];
                    }
                },
                async getVariantsForSelectedProduct() {
                    try {
                        const productId = this.getCurrentNodeParameter('productId');
                        if (!productId)
                            return [{ name: '⚠ Pick a Product First', value: '' }];
                        const data = await fetchPaginated(this, `products/${productId}/variants`);
                        if (data.length === 0)
                            return [{ name: 'No Variants on This Product', value: '' }];
                        return data.map((variant) => {
                            const price = asDataObject(variant.price ?? {});
                            const optionValues = Array.isArray(variant.related_option_values)
                                ? `options ${variant.related_option_values.join('/')}`
                                : 'variant';
                            return {
                                name: `${variant.sku || optionValues} — qty ${variant.stock_quantity ?? '?'} (${price.amount ?? '?'} ${price.currency || 'SAR'})`,
                                value: String(variant.id),
                            };
                        });
                    }
                    catch (err) {
                        return [{ name: `⚠ Error loading variants: ${err?.message || 'check credentials'}`, value: '' }];
                    }
                },
                async getCustomers() {
                    try {
                        const data = await fetchPaginated(this, 'customers');
                        return data.map((c) => ({
                            name: `${c.full_name || c.first_name + ' ' + c.last_name} — ${c.mobile || ''} (${c.email || 'no email'})`,
                            value: String(c.id),
                        }));
                    }
                    catch (error) {
                        return [{ name: `⚠ Could not load customers: ${error?.message || 'check the SallaFlow credential and customers.read scope'}`, value: '' }];
                    }
                },
                async getCoupons() {
                    try {
                        const data = await fetchPaginated(this, 'coupons');
                        return data.map((c) => {
                            const amount = asDataObject(c.amount ?? {});
                            return {
                                name: `${c.code} — ${c.type} ${amount.amount || '?'}${c.type === 'percentage' ? '%' : ' ' + (amount.currency || 'SAR')} (${c.status || ''})`,
                                value: String(c.id),
                            };
                        });
                    }
                    catch (error) {
                        return [{ name: `⚠ Could not load coupons: ${error?.message || 'check the SallaFlow credential and marketing.read scope'}`, value: '' }];
                    }
                },
                async getOrderStatuses() {
                    try {
                        const resp = await this.helpers.httpRequestWithAuthentication.call(
                            this,
                            'sallaFlowApi',
                            {
                                method: 'GET',
                                url: `${API}/api/v1/salla/orders/statuses`,
                                headers: readTelemetryHeaders('dynamic-loader'),
                            },
                        ) as IDataObject;
                        const data = Array.isArray(resp.data) ? resp.data as IDataObject[] : [];
                        return data.map((s) => ({
                            name: `${s.name} (${s.slug})`,
                            value: String(s.id),
                        }));
                    }
                    catch {
                        return [{ name: '⚠ Error Loading Statuses — Check Credentials', value: '' }];
                    }
                },
                async getCanceledOrderStatuses() {
                    try {
                        const resp = await this.helpers.httpRequestWithAuthentication.call(
                            this,
                            'sallaFlowApi',
                            {
                                method: 'GET',
                                url: `${API}/api/v1/salla/orders/statuses`,
                                headers: readTelemetryHeaders('dynamic-loader'),
                            },
                        ) as IDataObject;
                        const data = Array.isArray(resp.data) ? resp.data as IDataObject[] : [];
                        const canceled = data.filter((status) => (
                            /cancel|إلغاء|ملغ/i.test(`${status.slug || ''} ${status.name || ''}`)
                        ));
                        if (canceled.length === 0) {
                            return [{ name: '⚠ No Canceled Status Found in This Store', value: '' }];
                        }
                        return canceled.map((status) => ({
                            name: `${status.name} (${status.slug})`,
                            value: String(status.id),
                        }));
                    }
                    catch (error) {
                        return [{ name: `⚠ Could not load canceled statuses: ${error?.message || 'check orders.read scope'}`, value: '' }];
                    }
                },
                async getCategories() {
                    try {
                        const data = await fetchPaginated(this, 'categories');
                        return data.map((c) => ({
                            name: String(c.name || ''),
                            value: String(c.id),
                        }));
                    }
                    catch (error) {
                        return [{ name: `⚠ Could not load categories: ${error?.message || 'check the SallaFlow credential and categories.read scope'}`, value: '' }];
                    }
                },
                async getCouponsForOrder() {
                    try {
                        const data = await fetchPaginated(this, 'coupons');
                        const options = [{ name: 'No Coupon', value: '' }];
                        data.forEach((c) => {
                            const amount = asDataObject(c.amount ?? {});
                            options.push({
                                name: `${c.code} — ${c.type} ${amount.amount || '?'}${c.type === 'percentage' ? '%' : ' SAR'}`,
                                value: String(c.code || ''),
                            });
                        });
                        return options;
                    }
                    catch {
                        return [{ name: 'No Coupon', value: '' }];
                    }
                },
                async getBranches() {
                    try {
                        const data = await fetchPaginated(this, 'branches');
                        return data.map((b) => ({
                            name: `${b.name}${b.is_default ? ' (Default)' : ''}`,
                            value: String(b.id),
                        }));
                    }
                    catch {
                        return [{ name: '⚠ No Branches Found — Add branches.read Scope in Salla', value: '' }];
                    }
                },
                async getShippingCompanies() {
                    try {
                        const resp = await this.helpers.httpRequestWithAuthentication.call(
                            this,
                            'sallaFlowApi',
                            {
                                method: 'GET',
                                url: `${API}/api/v1/salla/shipping/companies/`,
                                headers: readTelemetryHeaders('dynamic-loader'),
                            },
                        ) as IDataObject;
                        const data = Array.isArray(resp.data) ? resp.data as IDataObject[] : [];
                        if (data.length === 0)
                            return [{ name: 'No Active Shipping Companies Found', value: '' }];
                        return data.map((company) => ({
                            name: `${company.name}${company.activation_type ? ` (${company.activation_type})` : ''}`,
                            value: String(company.id),
                        }));
                    }
                    catch {
                        return [{ name: '⚠ Error Loading Shipping Companies — Add shipping.read Scope in Salla', value: '' }];
                    }
                },
                async getProductOptions() {
                    try {
                        const data = await fetchPaginated(this, 'products');
                        const options = [];
                        for (const p of data) {
                            const productOptions = Array.isArray(p.options)
                                ? p.options as IDataObject[]
                                : [];
                            if (productOptions.length > 0) {
                                for (const opt of productOptions) {
                                    const optionValues = Array.isArray(opt.values)
                                        ? opt.values as IDataObject[]
                                        : [];
                                    if (optionValues.length > 0) {
                                        for (const val of optionValues) {
                                            options.push({
                                                name: `${p.name} → ${opt.name}: ${val.name}`,
                                                value: `${p.id}|${opt.id}|${val.id}`,
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        if (options.length === 0)
                            return [{ name: 'No Products with Options Found', value: '' }];
                        return options;
                    }
                    catch {
                        return [{ name: '⚠ Error Loading Product Options — Check Credentials', value: '' }];
                    }
                },
                async getBrands() {
                    try {
                        const data = await fetchPaginated(this, 'brands');
                        return data.map((b) => ({
                            name: `${b.name}${b.status ? ' (' + b.status + ')' : ''}`,
                            value: String(b.id),
                        }));
                    }
                    catch (error) {
                        return [{ name: `⚠ Could not load brands: ${error?.message || 'check the SallaFlow credential and brands.read scope'}`, value: '' }];
                    }
                },
                async getValuesForSelectedOption() {
                    // Fetch the selected option and list its values.
                    try {
                        const optionId = this.getCurrentNodeParameter('optionId');
                        if (!optionId) return [{ name: '⚠ Pick an Option First', value: '' }];
                        const resp = await this.helpers.httpRequestWithAuthentication.call(
                            this,
                            'sallaFlowApi',
                            {
                                method: 'GET',
                                url: `${API}/api/v1/salla/products/options/${optionId}`,
                                headers: readTelemetryHeaders('dynamic-loader'),
                            },
                        ) as IDataObject;
                        const responseData = asDataObject(resp.data ?? {});
                        const vals = Array.isArray(responseData.values)
                            ? responseData.values as IDataObject[]
                            : [];
                        if (vals.length === 0)
                            return [{ name: 'No Values on This Option', value: '' }];
                        return vals.map((v) => {
                            const priceObject = asDataObject(v.price ?? {});
                            const price = priceObject.amount ?? v.price;
                            const priceStr = price !== undefined && price !== null ? ` — ${price} ${priceObject.currency || ''}`.trim() : '';
                            const qtyStr = v.quantity !== undefined && v.quantity !== null ? ` (qty ${v.quantity})` : '';
                            return { name: `${v.name}${priceStr}${qtyStr}`, value: String(v.id) };
                        });
                    }
                    catch (err) {
                        return [{ name: `⚠ Error loading values: ${err?.message || 'unknown'}`, value: '' }];
                    }
                },
                async getOptionsForSelectedProduct() {
                    // Salla has no "list options for product" endpoint — options live inside the
                    // product payload, so we fetch the product and walk product.options[].
                    try {
                        const productId = this.getCurrentNodeParameter('productId');
                        if (!productId) return [{ name: '⚠ Pick a Product First', value: '' }];
                        const resp = await this.helpers.httpRequestWithAuthentication.call(
                            this,
                            'sallaFlowApi',
                            {
                                method: 'GET',
                                url: `${API}/api/v1/salla/products/${productId}`,
                                headers: readTelemetryHeaders('dynamic-loader'),
                            },
                        ) as IDataObject;
                        const responseData = asDataObject(resp.data ?? {});
                        const opts = Array.isArray(responseData.options)
                            ? responseData.options as IDataObject[]
                            : [];
                        if (opts.length === 0)
                            return [{ name: 'No Options on This Product Yet', value: '' }];
                        return opts.map((o) => ({
                            name: `${o.name} (${o.type}${o.purpose ? ' / ' + o.purpose : ''})`,
                            value: String(o.id),
                        }));
                    }
                    catch (err) {
                        return [{ name: `⚠ Error loading options: ${err?.message || 'unknown'}`, value: '' }];
                    }
                },
            },
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const ret: INodeExecutionData[] = [];
        const resource = this.getNodeParameter('resource', 0) as string;
        const operation = this.getNodeParameter('operation', 0) as string;
        const hdr = { 'Content-Type': 'application/json' };

        // ─────────────────────────────────────────────────────────────────────
        // sallaRequest: the one HTTP helper every operation should go through.
        //   • Sends each backend request exactly once. The backend owns safe
        //     read retransmissions after the single read-quota admission.
        //   • Mutating requests are never retried because an ambiguous response
        //     may follow a successful upstream write.
        //   • Gives every read a logical request ID and a bounded context label
        //     so backend requests and upstream transmissions can be correlated.
        //   • Fail-fast on 4xx (other than 429) — retrying a 422 is pointless.
        //   • Extracts a clean error message and THROWS NodeOperationError so
        //     n8n never sees raw axios errors (which contain socket/agent refs
        //     that break JSON.stringify → "Converting circular structure").
        //   • Gently paces consecutive calls with `spaceMs` between requests
        //     (per execution, not global) to smooth bursts during Return All
        //     and multi-type fan-out. Doesn't add latency to single calls.
        // ─────────────────────────────────────────────────────────────────────
        const helpers = this.helpers;
        const node = this.getNode();
        let lastCallAt = 0;
        const MIN_SPACING_MS = 60; // 60ms between sequential calls ≈ 1000/min ceiling per worker

        const extractError = (reqErr: unknown) => normalizeSallaError(reqErr);

        const sallaRequest = async (
            opts: IHttpRequestOptions,
            ctx?: RequestContext,
        ): Promise<IDataObject> => {
            // Pace sequential calls within this execution (not across workers)
            const wait = MIN_SPACING_MS - (Date.now() - lastCallAt);
            if (wait > 0) await sleep(wait);
            try {
                const requestOptions = withReadTelemetry(
                    opts,
                    String(ctx?.readContext || 'action'),
                );
                const out = await helpers.httpRequestWithAuthentication.call(
                    this,
                    'sallaFlowApi',
                    requestOptions,
                ) as IDataObject;
                lastCallAt = Date.now();
                return out;
            } catch (reqErr) {
                lastCallAt = Date.now();
                const info = extractError(reqErr);
                const prefix = info.status ? `[${info.status}] ` : '';
                throw new NodeOperationError(node, `${prefix}${info.msg}`, {
                    itemIndex: ctx?.itemIndex,
                    description: Object.keys(info.fields).length ? JSON.stringify(info.fields) : undefined,
                });
            }
        };
        const requireValue = (
            value: unknown,
            label: string,
            itemIndex: number,
        ): string => {
            const normalized = String(value ?? '').trim();
            if (!normalized) {
                throw new NodeOperationError(node, `${label} is required. Select a value or use an expression that resolves to an ID.`, { itemIndex });
            }
            return normalized;
        };
        const validateDate = (
            value: unknown,
            label: string,
            itemIndex: number,
        ): void => {
            if (!value) return;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
                throw new NodeOperationError(node, `${label} must use YYYY-MM-DD format, for example 2026-07-28.`, { itemIndex });
            }
        };
        const appendFilters = (
            targetUrl: string,
            filters: INodeParameters,
            fields: readonly string[],
            itemIndex: number,
        ): string => {
            for (const field of fields) {
                const value = filters?.[field];
                if (value === undefined || value === null || value === '') continue;
                if (field.includes('date')) {
                    const values = String(value).split(',').map((part) => part.trim()).filter(Boolean);
                    for (const part of values) validateDate(part, field.replace(/_/g, ' '), itemIndex);
                }
                targetUrl += `&${field}=${encodeURIComponent(String(value))}`;
            }
            return targetUrl;
        };

        const ep: Record<string, string> = { abandonedCart: 'carts/abandoned', order: 'orders', product: 'products', customer: 'customers', coupon: 'coupons', brand: 'brands', category: 'categories', feedback: 'feedbacks' };
        const idF: Record<string, string> = { abandonedCart: 'abandonedCartId', order: 'orderId', product: 'productId', customer: 'customerId', coupon: 'couponId', brand: 'brandId', category: 'categoryId' };
        for (let i = 0; i < items.length; i++) {
            try {
                const base = ep[resource];
                let url = '';
                let method: IHttpRequestMethods = 'GET';
                let body: IDataObject | undefined;
                let r: IDataObject | undefined;
                let preFetched = false;
                if (resource === 'productVariant' && operation === 'getAll') {
                    const returnAll = this.getNodeParameter('returnAll', i, false);
                    const perPage = returnAll ? 60 : this.getNodeParameter('limit', i, 20);
                    const startPage = returnAll ? 1 : this.getNodeParameter('page', i, 1);
                    const productId = this.getNodeParameter('productId', i);
                    url = `${API}/api/v1/salla/products/${productId}/variants?per_page=${perPage}&page=${startPage}`;
                }
                else if (resource === 'productVariant' && operation === 'get') {
                    const variantId = this.getNodeParameter('variantId', i);
                    url = `${API}/api/v1/salla/products/variants/${variantId}`;
                }
                else if (resource === 'productVariant' && operation === 'update') {
                    const variantId = this.getNodeParameter('variantId', i);
                    url = `${API}/api/v1/salla/products/variants/${variantId}`;
                    method = 'PUT';
                    const useJson = this.getNodeParameter('variantUseJson', i, false);
                    if (useJson) {
                        const parsedBody = parseJsonInput(this.getNodeParameter('variantJsonBody', i), this.getNode(), i, 'Variant JSON');
                        if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody) || Object.keys(parsedBody).length === 0)
                            throw new NodeOperationError(this.getNode(), 'Variant JSON must be a non-empty object with at least one field to update.', { itemIndex: i });
                        body = asDataObject(parsedBody);
                    }
                    else {
                        body = { ...asNodeParameters(this.getNodeParameter('variantUpdateFields', i, {})) };
                        const branchCollection = asNodeParameters(
                            this.getNodeParameter('variantBranchQuantities', i, {}),
                        );
                        const branches = Array.isArray(branchCollection.quantity)
                            ? asNodeParameterArray(branchCollection.quantity)
                            : [];
                        if (branches.length > 0) {
                            body.quantities = branches.map((entry, index) => {
                                const quantity = Number(entry.quantity);
                                if (!entry.branch || !Number.isFinite(quantity) || quantity < 0)
                                    throw new NodeOperationError(this.getNode(), `Branch quantity ${index + 1} requires a branch ID and a quantity greater than or equal to 0.`, { itemIndex: i });
                                const out: INodeParameters = { branch: entry.branch, quantity };
                                if (entry.reason_id)
                                    out.reason_id = entry.reason_id;
                                return out;
                            });
                        }
                        if (Object.keys(body).length === 0)
                            throw new NodeOperationError(this.getNode(), 'Choose at least one variant field or branch quantity to update.', { itemIndex: i });
                    }
                }
                else if (resource === 'productVariant' && operation === 'updateQuantity') {
                    const variantId = this.getNodeParameter('variantId', i);
                    const useJson = this.getNodeParameter('variantQuantityUseJson', i, false);
                    let entry: INodeParameters;
                    if (useJson) {
                        const raw = parseJsonInput(this.getNodeParameter('variantQuantityJsonBody', i), this.getNode(), i, 'Quantity JSON');
                        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
                            throw new NodeOperationError(this.getNode(), 'Quantity JSON must be an object.', { itemIndex: i });
                        entry = { ...asNodeParameters(raw) };
                    }
                    else {
                        const extra = asNodeParameters(
                            this.getNodeParameter('variantQuantityAdditionalFields', i, {}),
                        );
                        entry = {
                            quantity: Number(this.getNodeParameter('variantQuantity', i)),
                            mode: String(this.getNodeParameter('variantQuantityMode', i)),
                            ...extra,
                        };
                    }
                    entry.identifier_type = 'variant_id';
                    entry.identifier = String(variantId);
                    body = { products: normalizeInventoryItems([entry], this.getNode(), i) };
                    url = `${API}/api/v1/salla/products/quantities/bulk`;
                    method = 'POST';
                }
                else if (resource === 'product' && operation === 'updateInventoryBulk') {
                    const useJson = this.getNodeParameter('inventoryUseJson', i, false);
                    let raw: unknown;
                    if (useJson) {
                        raw = parseJsonInput(this.getNodeParameter('inventoryJsonBody', i), this.getNode(), i, 'Inventory JSON');
                    }
                    else {
                        const collection = asNodeParameters(
                            this.getNodeParameter('inventoryItems', i, {}),
                        );
                        const entries = Array.isArray(collection.item)
                            ? asNodeParameterArray(collection.item)
                            : [];
                        raw = entries.map((entry) => ({
                            identifier_type: entry.identifierType,
                            identifier: entry.identifier,
                            quantity: entry.quantity,
                            mode: entry.mode,
                            branch: entry.branch,
                            reason_id: entry.reason_id,
                            unlimited_quantity: entry.unlimited_quantity,
                        }));
                    }
                    body = { products: normalizeInventoryItems(raw, this.getNode(), i) };
                    url = `${API}/api/v1/salla/products/quantities/bulk`;
                    method = 'POST';
                }
                else if (operation === 'getAll' && resource !== 'productOption') {
                    const returnAll = this.getNodeParameter('returnAll', i, false);
                    const endpointMax = resource === 'order' ? 30 : 60;
                    const perPage = returnAll ? endpointMax : Math.min(endpointMax, Number(this.getNodeParameter('limit', i, 20)));
                    const startPage = returnAll ? 1 : this.getNodeParameter('page', i, 1);
                    url = `${API}/api/v1/salla/${base}?per_page=${perPage}&page=${startPage}`;
                    if (resource === 'abandonedCart') {
                        const filters = asNodeParameters(
                            this.getNodeParameter('abandonedCartFilters', i, {}),
                        );
                        if (filters.keyword)
                            url += `&keyword=${encodeURIComponent(String(filters.keyword))}`;
                    }
                    if (resource === 'order') {
                        const filters = asNodeParameters(
                            this.getNodeParameter('orderFilters', i, {}),
                        );
                        url = appendFilters(url, filters, ['keyword', 'reference_id', 'status', 'payment_method', 'customer_id', 'from_date', 'to_date'], i);
                    }
                    if (resource === 'customer') {
                        const filters = asNodeParameters(
                            this.getNodeParameter('customerFilters', i, {}),
                        );
                        url = appendFilters(url, filters, ['keyword', 'date_from', 'date_to'], i);
                    }
                    if (resource === 'coupon') {
                        const filters = asNodeParameters(
                            this.getNodeParameter('couponFilters', i, {}),
                        );
                        url = appendFilters(url, filters, ['keyword', 'creation_date', 'expiration_date'], i);
                    }
                    if (resource === 'brand') {
                        const filters = asNodeParameters(
                            this.getNodeParameter('brandFilters', i, {}),
                        );
                        url = appendFilters(url, filters, ['keyword'], i);
                    }
                    if (resource === 'category') {
                        const filters = asNodeParameters(
                            this.getNodeParameter('categoryFilters', i, {}),
                        );
                        url = appendFilters(url, filters, ['keyword', 'status'], i);
                    }
                    if (resource === 'product') {
                        const filters = asNodeParameters(
                            this.getNodeParameter('productFilters', i, {}),
                        );
                        if (filters.keyword)
                            url += `&keyword=${encodeURIComponent(String(filters.keyword))}`;
                        if (filters.status)
                            url += `&status=${filters.status}`;
                        if (filters.category) {
                            // Salla expects `categories[]=ID` (array). The singular `category=ID` is
                            // silently ignored server-side, returning unfiltered results. Support
                            // comma-separated multi-ID input too.
                            const catList = String(filters.category).split(',').map((s) => s.trim()).filter(Boolean);
                            for (const c of catList)
                                url += `&categories[]=${encodeURIComponent(c)}`;
                        }
                    }
                    if (resource === 'feedback') {
                        const filters = asNodeParameters(
                            this.getNodeParameter('feedbackFilters', i, {}),
                        );
                        // Build a base URL WITHOUT the type param; we may fan out per-type.
                        let fbBase = `${API}/api/v1/salla/feedbacks?per_page=${perPage}`;
                        if (filters.keyword)
                            fbBase += `&keyword=${encodeURIComponent(String(filters.keyword))}`;
                        if (filters.start_date)
                            fbBase += `&start_date=${encodeURIComponent(String(filters.start_date))}`;
                        if (filters.end_date)
                            fbBase += `&end_date=${encodeURIComponent(String(filters.end_date))}`;
                        const appendList = (key: string, raw: unknown): void => {
                            if (!raw) return;
                            const list = Array.isArray(raw)
                                ? raw
                                : String(raw).split(',').map((s) => s.trim()).filter(Boolean);
                            for (const v of list)
                                fbBase += `&${key}[]=${encodeURIComponent(String(v))}`;
                        };
                        appendList('products', filters.products);
                        appendList('blogs', filters.blogs);
                        appendList('customers', filters.customers);
                        appendList('stars', filters.stars);
                        if (filters.reply !== undefined && filters.reply !== '' && filters.reply !== null)
                            fbBase += `&reply=${filters.reply ? 'true' : 'false'}`;
                        if (filters.publish !== undefined && filters.publish !== '' && filters.publish !== null)
                            fbBase += `&publish=${filters.publish ? 'true' : 'false'}`;

                        // Normalize types: array (multiOptions), string (legacy), or empty = no filter.
                        const rawTypes = filters.type;
                        const typesList = Array.isArray(rawTypes)
                            ? rawTypes.filter(Boolean)
                            : (rawTypes ? [rawTypes] : []);
                        const typeQueries = typesList.length > 0 ? typesList : [''];

                        // Fan out: one fetch chain per selected type, each with its own returnAll loop.
                        // All HTTP goes through sallaRequest → retry/backoff/clean errors are automatic.
                        const combined: IDataObject[] = [];
                        let lastPagination: IDataObject | null = null;
                        for (const t of typeQueries) {
                            const pageUrl = `${fbBase}&page=${startPage}${t ? `&type=${encodeURIComponent(String(t))}` : ''}`;
                            const first = await sallaRequest(
                                { method: 'GET', url: pageUrl, headers: hdr },
                                { itemIndex: i, readContext: 'feedback-fanout' },
                            );
                            if (Array.isArray(first.data))
                                combined.push(...first.data as IDataObject[]);
                            lastPagination = first.pagination
                                ? asDataObject(first.pagination)
                                : lastPagination;
                            if (returnAll) {
                                const maxPages = 500;
                                const firstPagination = asDataObject(first.pagination ?? {});
                                let currentPage = Number(firstPagination.currentPage || 1);
                                const totalPages = Number(firstPagination.totalPages || 1);
                                while (currentPage < totalPages && currentPage < maxPages) {
                                    currentPage++;
                                    const nextUrl = pageUrl.replace(/([?&])page=\d+/, `$1page=${currentPage}`);
                                    const nextR = await sallaRequest(
                                        { method: 'GET', url: nextUrl, headers: hdr },
                                        { itemIndex: i, readContext: 'pagination' },
                                    );
                                    if (Array.isArray(nextR?.data) && nextR.data.length > 0)
                                        combined.push(...nextR.data);
                                    else
                                        break;
                                }
                                if (currentPage >= maxPages && totalPages > maxPages) {
                                    throw new NodeOperationError(
                                        this.getNode(),
                                        `Feedback Return All stopped at the 500-page safety limit for type "${t || 'all'}". Add date or type filters.`,
                                        { itemIndex: i },
                                    );
                                }
                            }
                        }
                        const seenFeedbackIds = new Set();
                        const unique = combined.filter((entry) => {
                            if (entry?.id === undefined || entry?.id === null) return true;
                            const key = String(entry.id);
                            if (seenFeedbackIds.has(key)) return false;
                            seenFeedbackIds.add(key);
                            return true;
                        });
                        const finalData = returnAll ? unique : unique.slice(0, perPage);
                        r = {
                            data: finalData,
                            pagination: {
                                ...(lastPagination || {}),
                                count: finalData.length,
                                combinedTypes: typesList,
                            },
                            success: true,
                        };
                        preFetched = true;
                        url = 'prefetched'; // satisfy !url check below
                    }
                }
                else if (operation === 'get' && resource !== 'productOption') {
                    const id = requireValue(this.getNodeParameter(idF[resource], i), `${resource} ID`, i);
                    url = `${API}/api/v1/salla/${base}/${encodeURIComponent(id)}`;
                }
                else if (operation === 'delete' && resource !== 'productOption') {
                    const id = requireValue(this.getNodeParameter(idF[resource], i), `${resource} ID`, i);
                    url = `${API}/api/v1/salla/${base}/${encodeURIComponent(id)}`;
                    method = 'DELETE';
                }
                else if (operation === 'cancel') {
                    const statusId = requireValue(this.getNodeParameter('statusId', i), 'Canceled status', i);
                    const useMultiple = this.getNodeParameter('orderUseMultiple', i, false);
                    if (useMultiple) {
                        const orderIds = [...new Set(csvToArray(this.getNodeParameter('orderIds', i, []), false))];
                        if (orderIds.length === 0) {
                            throw new NodeOperationError(this.getNode(), 'Select at least one order to cancel.', { itemIndex: i });
                        }
                        const results = [];
                        for (const orderId of orderIds) {
                            try {
                                const response = await sallaRequest({
                                    method: 'POST',
                                    url: `${API}/api/v1/salla/${base}/${encodeURIComponent(orderId)}/status`,
                                    headers: hdr,
                                    body: { status_id: Number(statusId) },
                                }, { itemIndex: i, ctx: `cancel order ${orderId}` });
                                results.push({ order_id: orderId, success: true, data: response?.data || response });
                            }
                            catch (error) {
                                results.push({ order_id: orderId, success: false, error: error?.message || 'Unknown error' });
                            }
                        }
                        r = {
                            data: {
                                total: results.length,
                                succeeded: results.filter((entry) => entry.success).length,
                                failed: results.filter((entry) => !entry.success).length,
                                results,
                            },
                        };
                        preFetched = true;
                        url = 'prefetched';
                    }
                    else {
                        const orderId = requireValue(this.getNodeParameter('orderId', i), 'Order ID', i);
                        url = `${API}/api/v1/salla/${base}/${encodeURIComponent(orderId)}/status`;
                        method = 'POST';
                        body = { status_id: Number(statusId) };
                    }
                }
                else if (operation === 'updateStatus') {
                    const statusId = requireValue(this.getNodeParameter('statusId', i), 'Order status', i);
                    const useMultiple = this.getNodeParameter('orderUseMultiple', i, false);
                    if (useMultiple) {
                        const orderIds = [...new Set(csvToArray(this.getNodeParameter('orderIds', i, []), false))];
                        if (orderIds.length === 0) {
                            throw new NodeOperationError(this.getNode(), 'Select at least one order to update.', { itemIndex: i });
                        }
                        const results = [];
                        for (const orderId of orderIds) {
                            try {
                                const response = await sallaRequest({
                                    method: 'POST',
                                    url: `${API}/api/v1/salla/${base}/${encodeURIComponent(orderId)}/status`,
                                    headers: hdr,
                                    body: { status_id: Number(statusId) },
                                }, { itemIndex: i, ctx: `update status for order ${orderId}` });
                                results.push({ order_id: orderId, success: true, data: response?.data || response });
                            }
                            catch (error) {
                                results.push({ order_id: orderId, success: false, error: error?.message || 'Unknown error' });
                            }
                        }
                        r = {
                            data: {
                                total: results.length,
                                succeeded: results.filter((entry) => entry.success).length,
                                failed: results.filter((entry) => !entry.success).length,
                                results,
                            },
                        };
                        preFetched = true;
                        url = 'prefetched';
                    }
                    else {
                        const orderId = requireValue(this.getNodeParameter('orderId', i), 'Order ID', i);
                        url = `${API}/api/v1/salla/${base}/${encodeURIComponent(orderId)}/status`;
                        method = 'POST';
                        body = { status_id: Number(statusId) };
                    }
                    // ── Product: Attach Image ──
                }
                else if (operation === 'attachImage') {
                    const productId = this.getNodeParameter('productId', i);
                    url = `${API}/api/v1/salla-upload/products/${productId}/images`;
                    method = 'POST';
                    body = {
                        image_url: this.getNodeParameter('imageUrl', i),
                        main: this.getNodeParameter('imageMain', i, false),
                        sort: this.getNodeParameter('imageSort', i, 1),
                    };
                    const alt = this.getNodeParameter('imageAlt', i, '');
                    if (alt)
                        body.alt = alt;
                    // ── Product: Update Quantity ──
                }
                else if (operation === 'updateQuantity') {
                    const productId = this.getNodeParameter('productId', i);
                    url = `${API}/api/v1/salla/products/${productId}`;
                    method = 'PUT';
                    const unlimited = this.getNodeParameter('unlimitedQuantity', i);
                    body = unlimited
                        ? { unlimited_quantity: true }
                        : { quantity: this.getNodeParameter('quantityValue', i) };
                }
                else if (resource === 'productOption' && operation === 'create') {
                    // POST /products/{productId}/options — supports one or more options via fan-out
                    const productId = this.getNodeParameter('productId', i);
                    const optUrl = `${API}/api/v1/salla/products/${productId}/options`;
                    const useJson = this.getNodeParameter('optionUseJson', i, false);
                    let optionsToAdd: IDataObject[] = [];
                    if (useJson) {
                        const raw = this.getNodeParameter('optionJsonBodyCreate', i);
                        let parsed: unknown;
                        if (typeof raw === 'string') {
                            try { parsed = JSON.parse(raw) as unknown; }
                            catch { throw new NodeOperationError(this.getNode(), 'Options JSON is not valid JSON. If you are using an n8n expression, make sure it starts with "=" (e.g. "={{ [...] }}").', { itemIndex: i }); }
                        } else {
                            parsed = raw;
                        }
                        optionsToAdd = Array.isArray(parsed)
                            ? parsed as IDataObject[]
                            : (parsed ? [asDataObject(parsed)] : []);
                    } else {
                        const optList = asNodeParameters(
                            this.getNodeParameter('optionsList', i, {}),
                        );
                        const optionEntries = Array.isArray(optList.option)
                            ? asNodeParameterArray(optList.option)
                            : [];
                        if (optionEntries.length > 0) {
                            optionsToAdd = optionEntries.map((o) => {
                                const opt: IDataObject = {
                                    name: o.name,
                                    purpose: o.purpose || 'variants',
                                    type: o.type || 'radio',
                                    display_type: o.display_type || 'text',
                                    required: o.required || false,
                                };
                                if (o.description) opt.description = o.description;
                                const valuesCollection = asNodeParameters(o.values ?? {});
                                const valueEntries = Array.isArray(valuesCollection.value)
                                    ? asNodeParameterArray(valuesCollection.value)
                                    : [];
                                if (valueEntries.length > 0) {
                                    opt.values = valueEntries.map((v) => {
                                        const val: IDataObject = { name: v.name, price: v.price || 0 };
                                        if (v.quantity) val.quantity = v.quantity;
                                        if (v.display_value) val.display_value = v.display_value;
                                        if (v.is_default) val.is_default = v.is_default;
                                        return val;
                                    });
                                }
                                return opt;
                            });
                        }
                    }
                    if (optionsToAdd.length === 0) {
                        throw new NodeOperationError(this.getNode(), 'No options to create. Add at least one entry in "Options" or provide a non-empty JSON array.', { itemIndex: i });
                    }
                    const optResults = [];
                    for (const optBody of optionsToAdd) {
                        const optResp = await sallaRequest(
                            { method: 'POST', url: optUrl, headers: hdr, body: optBody },
                            { itemIndex: i, ctx: `productOption/create name=${optBody.name}` },
                        );
                        optResults.push(optResp.data || optResp);
                    }
                    ret.push({
                        json: { product_id: productId, options_created: optResults },
                        pairedItem: { item: i },
                    });
                    continue;
                }
                else if (resource === 'productOption' && operation === 'get') {
                    // Salla uses /products/options/{optionId} — productId NOT in path
                    const optionId = this.getNodeParameter('optionId', i);
                    url = `${API}/api/v1/salla/products/options/${optionId}`;
                    method = 'GET';
                }
                else if (resource === 'productOption' && operation === 'getAll') {
                    // Salla has no "list options" endpoint — fetch product and return its options array
                    const productId = this.getNodeParameter('productId', i);
                    const prodResp = await sallaRequest(
                        { method: 'GET', url: `${API}/api/v1/salla/products/${productId}`, headers: hdr },
                        { itemIndex: i, ctx: `productOption/getAll product=${productId}` },
                    );
                    const productData = asDataObject(prodResp.data ?? {});
                    r = { data: productData.options || [], success: true };
                    preFetched = true;
                    url = 'prefetched';
                }
                else if (resource === 'productOption' && operation === 'delete') {
                    const useJson = this.getNodeParameter('deleteUseJson', i, false);
                    const idsToDelete = [];
                    let bulkMode = false;
                    if (useJson) {
                        const raw = this.getNodeParameter('deleteJsonBody', i);
                        let parsed;
                        if (typeof raw === 'string') {
                            try { parsed = JSON.parse(raw); }
                            catch { throw new NodeOperationError(this.getNode(), 'Option IDs JSON is not valid JSON. If using an n8n expression, make sure it starts with "=".', { itemIndex: i }); }
                        } else { parsed = raw; }
                        const entries = Array.isArray(parsed) ? parsed : [parsed];
                        bulkMode = Array.isArray(parsed);
                        for (const e of entries) {
                            const id = typeof e === 'object' ? e?.id : e;
                            if (id === undefined || id === null || id === '')
                                throw new NodeOperationError(this.getNode(), 'Each JSON entry must be an ID or an object with an "id" field.', { itemIndex: i });
                            idsToDelete.push(String(id));
                        }
                    } else {
                        idsToDelete.push(String(this.getNodeParameter('optionId', i)));
                    }

                    const results: IDataObject[] = [];
                    for (const optionId of idsToDelete) {
                        try {
                            await sallaRequest(
                                { method: 'DELETE', url: `${API}/api/v1/salla/products/options/${optionId}`, headers: hdr },
                                { itemIndex: i, ctx: `delete option id=${optionId}` },
                            );
                            results.push({ id: optionId, success: true });
                        } catch (err) {
                            const requestError = asRequestError(err);
                            const entry: IDataObject = {
                                id: optionId,
                                success: false,
                                error: requestError.message || 'Unknown error',
                            };
                            if (requestError.description) {
                                try { entry.field_errors = JSON.parse(requestError.description); }
                                catch { entry.field_errors = requestError.description; }
                            }
                            results.push(entry);
                        }
                    }
                    if (!bulkMode) {
                        const r0 = results[0];
                        if (!r0.success) throw new NodeOperationError(this.getNode(), String(r0.error), { itemIndex: i });
                        ret.push({
                            json: { id: r0.id, success: true },
                            pairedItem: { item: i },
                        });
                    } else {
                        ret.push({
                            json: {
                                total: results.length,
                                succeeded: results.filter(r => r.success).length,
                                failed: results.filter(r => !r.success).length,
                                results,
                            },
                            pairedItem: { item: i },
                        });
                    }
                    continue;
                }
                else if (resource === 'productOption' && operation === 'updateValue') {
                    // Supports form mode (single dropdown value) and JSON mode (single object or array of objects).
                    // Each update does GET-merge-PUT to preserve fields Salla requires (like name) and
                    // avoid silently wiping unspecified fields via replace-semantics.
                    const useJson = this.getNodeParameter('valueUseJson', i, false);
                    const updatesToApply: Array<{
                        overrides: IDataObject;
                        valueId: string;
                    }> = [];

                    if (useJson) {
                        const raw = this.getNodeParameter('valueJsonBody', i);
                        let parsed: unknown;
                        if (typeof raw === 'string') {
                            try { parsed = JSON.parse(raw) as unknown; }
                            catch { throw new NodeOperationError(this.getNode(), 'Value JSON is not valid JSON. If using an n8n expression, make sure it starts with "=".', { itemIndex: i }); }
                        } else { parsed = raw; }
                        const entries = Array.isArray(parsed) ? parsed : [parsed];
                        for (const rawEntry of entries) {
                            const entry = asDataObject(rawEntry);
                            if (!rawEntry || entry.id === undefined || entry.id === null || entry.id === '')
                                throw new NodeOperationError(this.getNode(), 'Each JSON entry must include an "id" field (the value ID to update).', { itemIndex: i });
                            const { id, ...overrides } = entry;
                            updatesToApply.push({ valueId: String(id), overrides });
                        }
                    } else {
                        const valueId = this.getNodeParameter('optionValueId', i);
                        const overrides: IDataObject = {};
                        const newName = this.getNodeParameter('updateValueName', i, '');
                        const newPrice = this.getNodeParameter('updateValuePrice', i, '');
                        const newQty = this.getNodeParameter('updateValueQuantity', i, '');
                        const newDisplay = this.getNodeParameter('updateValueDisplayValue', i, '');
                        const newIsDefault = this.getNodeParameter('updateValueIsDefault', i, '');
                        if (newName !== '') overrides.name = newName;
                        if (newPrice !== '' && newPrice !== null) {
                            const p = Number(newPrice);
                            if (Number.isNaN(p))
                                throw new NodeOperationError(this.getNode(), `Price must be a number (got "${newPrice}")`, { itemIndex: i });
                            overrides.price = p;
                        }
                        if (newQty !== '' && newQty !== null) {
                            const q = Number(newQty);
                            if (Number.isNaN(q))
                                throw new NodeOperationError(this.getNode(), `Quantity must be a number (got "${newQty}")`, { itemIndex: i });
                            overrides.quantity = q;
                        }
                        if (newDisplay !== '') overrides.display_value = newDisplay;
                        if (newIsDefault === 'true') overrides.is_default = true;
                        else if (newIsDefault === 'false') overrides.is_default = false;
                        if (Object.keys(overrides).length === 0)
                            throw new NodeOperationError(this.getNode(), 'Nothing to update — fill at least one field.', { itemIndex: i });
                        updatesToApply.push({ valueId: String(valueId), overrides });
                    }

                    const results: IDataObject[] = [];
                    for (const { valueId, overrides } of updatesToApply) {
                        try {
                            const curResp = await sallaRequest(
                                { method: 'GET', url: `${API}/api/v1/salla/products/options/values/${valueId}`, headers: hdr },
                                { itemIndex: i, ctx: `updateValue GET valueId=${valueId}` },
                            );
                            const cur = asDataObject(curResp.data ?? {});
                            const currentPrice = asDataObject(cur.price ?? {});
                            const merged: IDataObject = {
                                name: cur.name,
                                price: currentPrice.amount ?? cur.price ?? 0,
                                ...(cur.quantity !== undefined && cur.quantity !== null ? { quantity: cur.quantity } : {}),
                                ...(cur.display_value ? { display_value: cur.display_value } : {}),
                                ...(cur.is_default ? { is_default: cur.is_default } : {}),
                                ...overrides,
                            };
                            const putResp = await sallaRequest(
                                { method: 'PUT', url: `${API}/api/v1/salla/products/options/values/${valueId}`, headers: hdr, body: merged },
                                { itemIndex: i, ctx: `updateValue PUT valueId=${valueId}` },
                            );
                            results.push({ id: valueId, success: true, data: putResp?.data || putResp });
                        } catch (err) {
                            const requestError = asRequestError(err);
                            const entry: IDataObject = {
                                id: valueId,
                                success: false,
                                error: requestError.message || 'Unknown error',
                            };
                            if (requestError.description) {
                                try { entry.field_errors = JSON.parse(requestError.description); }
                                catch { entry.field_errors = requestError.description; }
                            }
                            results.push(entry);
                        }
                    }
                    const summary = {
                        total: results.length,
                        succeeded: results.filter(r => r.success).length,
                        failed: results.filter(r => !r.success).length,
                        results,
                    };
                    ret.push({ json: summary, pairedItem: { item: i } });
                    continue;
                }
                else if (resource === 'productOption' && operation === 'update') {
                    // SAFETY: Salla's PUT /products/options/{optionId} is replace-semantics.
                    // For every option being updated we GET current state, merge user's overrides on
                    // top, and PUT the full merged body. Three input modes:
                    //   1. Form mode (single) — uses optionId dropdown + form fields
                    //   2. JSON mode, single object — uses optionId dropdown, body = form field overrides (from JSON)
                    //   3. JSON mode, array — each entry has its own "id"; loops and does GET-merge-PUT per entry
                    const useJson = this.getNodeParameter('optionUseJson', i, false);
                    const updatesToApply: Array<{
                        optionId: string;
                        overrides: IDataObject;
                    }> = [];
                    let bulkMode = false;

                    const buildFormOverrides = (): IDataObject => {
                        const overrides: IDataObject = {};
                        const name = this.getNodeParameter('updateOptionName', i, '');
                        const description = this.getNodeParameter('updateOptionDescription', i, '');
                        const purpose = this.getNodeParameter('updateOptionPurpose', i, '');
                        const type = this.getNodeParameter('updateOptionType', i, '');
                        const displayType = this.getNodeParameter('updateOptionDisplayType', i, '');
                        const required = this.getNodeParameter('updateOptionRequired', i, '');
                        const replaceValues = this.getNodeParameter('updateOptionReplaceValues', i, false);
                        if (name) overrides.name = name;
                        if (description) overrides.description = description;
                        if (purpose) overrides.purpose = purpose;
                        if (type) overrides.type = type;
                        if (displayType) overrides.display_type = displayType;
                        if (required === 'true') overrides.required = true;
                        else if (required === 'false') overrides.required = false;
                        if (replaceValues) {
                            const valColl = asNodeParameters(
                                this.getNodeParameter('updateOptionValues', i, {}),
                            );
                            const vals = Array.isArray(valColl.value)
                                ? asNodeParameterArray(valColl.value)
                                : [];
                            overrides.values = vals.map((v) => {
                                const out: IDataObject = { name: v.name, price: v.price || 0 };
                                if (v.quantity) out.quantity = v.quantity;
                                if (v.display_value) out.display_value = v.display_value;
                                if (v.is_default) out.is_default = v.is_default;
                                return out;
                            });
                        }
                        return overrides;
                    };

                    if (useJson) {
                        const raw = this.getNodeParameter('optionJsonBodyUpdate', i);
                        let parsed: unknown;
                        if (typeof raw === 'string') {
                            try { parsed = JSON.parse(raw) as unknown; }
                            catch { throw new NodeOperationError(this.getNode(), 'Option JSON is not valid JSON. If using an n8n expression, make sure it starts with "=".', { itemIndex: i }); }
                        } else { parsed = raw; }
                        if (Array.isArray(parsed)) {
                            bulkMode = true;
                            for (const rawEntry of parsed) {
                                const entry = asDataObject(rawEntry);
                                if (!rawEntry || entry.id === undefined || entry.id === null || entry.id === '')
                                    throw new NodeOperationError(this.getNode(), 'Each bulk JSON entry must include an "id" field (the option ID to update).', { itemIndex: i });
                                const { id, ...overrides } = entry;
                                updatesToApply.push({ optionId: String(id), overrides });
                            }
                        } else {
                            const optionId = this.getNodeParameter('optionId', i);
                            updatesToApply.push({
                                optionId: String(optionId),
                                overrides: asDataObject(parsed || {}),
                            });
                        }
                    } else {
                        const optionId = this.getNodeParameter('optionId', i);
                        updatesToApply.push({ optionId: String(optionId), overrides: buildFormOverrides() });
                    }

                    const results: IDataObject[] = [];
                    for (const { optionId, overrides } of updatesToApply) {
                        try {
                            const curResp = await sallaRequest(
                                { method: 'GET', url: `${API}/api/v1/salla/products/options/${optionId}`, headers: hdr },
                                { itemIndex: i, ctx: `update option GET optionId=${optionId}` },
                            );
                            const cur = asDataObject(curResp.data ?? {});
                            const curWritable: IDataObject = { ...cur };
                            delete curWritable.id;
                            delete curWritable.product_id;
                            delete curWritable.associated_with_variant;
                            delete curWritable.visibility_condition;
                            const preservedValues = Array.isArray(cur.values)
                                ? (cur.values as IDataObject[]).map((v) => {
                                    const valuePrice = asDataObject(v.price ?? {});
                                    return {
                                        id: v.id,
                                        name: v.name,
                                        price: valuePrice.amount ?? v.price ?? 0,
                                        ...(v.quantity !== undefined && v.quantity !== null ? { quantity: v.quantity } : {}),
                                        ...(v.display_value ? { display_value: v.display_value } : {}),
                                        ...(v.is_default ? { is_default: v.is_default } : {}),
                                    };
                                })
                                : [];
                            const merged: IDataObject = { ...curWritable, values: preservedValues, ...overrides };
                            const putResp = await sallaRequest(
                                { method: 'PUT', url: `${API}/api/v1/salla/products/options/${optionId}`, headers: hdr, body: merged },
                                { itemIndex: i, ctx: `update option PUT optionId=${optionId}` },
                            );
                            results.push({ id: optionId, success: true, data: putResp?.data || putResp });
                        } catch (err) {
                            const requestError = asRequestError(err);
                            const entry: IDataObject = {
                                id: optionId,
                                success: false,
                                error: requestError.message || 'Unknown error',
                            };
                            if (requestError.description) {
                                try { entry.field_errors = JSON.parse(requestError.description); }
                                catch { entry.field_errors = requestError.description; }
                            }
                            results.push(entry);
                        }
                    }

                    // Single-update mode (form or JSON object): return the single result directly
                    // Bulk mode (JSON array): return aggregated summary
                    if (!bulkMode) {
                        const r0 = results[0];
                        if (!r0.success) throw new NodeOperationError(this.getNode(), String(r0.error), { itemIndex: i });
                        ret.push({ json: asDataObject(r0.data ?? {}), pairedItem: { item: i } });
                    } else {
                        ret.push({
                            json: {
                                total: results.length,
                                succeeded: results.filter(r => r.success).length,
                                failed: results.filter(r => !r.success).length,
                                results,
                            },
                            pairedItem: { item: i },
                        });
                    }
                    continue;
                }
                else if (operation === 'create' || operation === 'update') {
                    const useCustom = this.getNodeParameter('useCustomJson', i, false);
                    if (useCustom) {
                        body = parseJsonObject(this.getNodeParameter('customJsonBody', i), 'Advanced JSON Body', this.getNode(), i);
                        if (!hasFields(body)) {
                            throw new NodeOperationError(this.getNode(), 'Advanced JSON Body must contain at least one field.', { itemIndex: i });
                        }
                        // ── Order Create ──
                    }
                    else if (resource === 'order' && operation === 'create') {
                        const customerId = requireValue(this.getNodeParameter('orderCustomerId', i), 'Customer', i);
                        const payStatus = this.getNodeParameter('orderPaymentStatus', i);
                        const customerIdNumber = Number(customerId);
                        if (!Number.isSafeInteger(customerIdNumber) || customerIdNumber <= 0) {
                            throw new NodeOperationError(this.getNode(), 'Customer is required and must contain a valid numeric Salla ID.', { itemIndex: i });
                        }
                        const buildProductLine = (
                            productIdValue: unknown,
                            quantityValue: unknown,
                            selectedOptionsValue: unknown,
                            lineNumber: number,
                        ): IDataObject => {
                            const productId = requireValue(productIdValue, `Product ${lineNumber}`, i);
                            const productIdNumber = Number(productId);
                            if (!Number.isSafeInteger(productIdNumber) || productIdNumber <= 0) {
                                throw new NodeOperationError(this.getNode(), `Product is required and must contain a valid numeric Salla ID (line ${lineNumber}).`, { itemIndex: i });
                            }
                            const qty = Number(quantityValue);
                            if (!Number.isFinite(qty) || qty < 1) {
                                throw new NodeOperationError(this.getNode(), `Product ${lineNumber} quantity must be a number of 1 or more.`, { itemIndex: i });
                            }
                            const product: IDataObject = { identifier_type: 'id', identifier: productIdNumber, quantity: qty };
                            const selectedOptions = Array.isArray(selectedOptionsValue)
                                ? selectedOptionsValue
                                : csvToArray(selectedOptionsValue, false);
                            if (selectedOptions.length === 0)
                                return product;
                            const optionsMap: Record<string, string[]> = {};
                            for (const sel of selectedOptions) {
                                const [pId, optId, valId, ...unexpected] = String(sel).split('|');
                                if (!pId || !optId || !valId || unexpected.length > 0
                                    || !Number.isSafeInteger(Number(optId)) || Number(optId) <= 0
                                    || !Number.isSafeInteger(Number(valId)) || Number(valId) <= 0) {
                                    throw new NodeOperationError(this.getNode(), `Product ${lineNumber} option "${sel}" is malformed. Select the option again.`, { itemIndex: i });
                                }
                                if (pId !== String(productId)) {
                                    throw new NodeOperationError(this.getNode(), `Product ${lineNumber} option "${sel}" belongs to product ${pId}, but this line uses product ${productId}.`, { itemIndex: i });
                                }
                                if (!optionsMap[optId])
                                    optionsMap[optId] = [];
                                optionsMap[optId].push(valId);
                            }
                            product.options = Object.entries(optionsMap).map(([id, vals]) => ({
                                id: Number(id), value: vals,
                            }));
                            return product;
                        };
                        const useMultipleProducts = this.getNodeParameter('orderUseMultipleProducts', i, false);
                        let products: IDataObject[];
                        if (useMultipleProducts) {
                            const collection = asNodeParameters(
                                this.getNodeParameter('orderProducts', i, {}),
                            );
                            const productLines = Array.isArray(collection.product)
                                ? asNodeParameterArray(collection.product)
                                : [];
                            if (productLines.length === 0) {
                                throw new NodeOperationError(this.getNode(), 'Add at least one product line to the order.', { itemIndex: i });
                            }
                            products = productLines.map((line, index) => buildProductLine(
                                line.productId,
                                line.quantity,
                                line.options || [],
                                index + 1,
                            ));
                        }
                        else {
                            products = [buildProductLine(
                                this.getNodeParameter('orderProductId', i),
                                this.getNodeParameter('orderProductQty', i),
                                this.getNodeParameter('orderProductOptions', i, []),
                                1,
                            )];
                        }
                        const extra = asNodeParameters(
                            this.getNodeParameter('orderAdditionalFields', i, {}),
                        );
                        // Merge additional products if provided
                        if (extra.extra_products) {
                            const more = parseJsonArray(extra.extra_products, 'Additional Products JSON', this.getNode(), i);
                            products.push(...more.map((entry) => asDataObject(entry)));
                        }
                        const payment: IDataObject = { status: payStatus };
                        if (payStatus === 'paid') {
                            const payMethod = this.getNodeParameter('orderPaymentMethod', i);
                            if (!payMethod) {
                                throw new NodeOperationError(this.getNode(), 'Payment Method is required when Payment Status is Paid.', { itemIndex: i });
                            }
                            payment.method = String(payMethod);
                            if (payMethod === 'cod')
                                payment.cash_on_delivery = { amount: 0, currency: 'SAR' };
                        }
                        else if (payStatus === 'pending_payment') {
                            const accepted = this.getNodeParameter('orderAcceptedMethods', i);
                            if (!Array.isArray(accepted) || accepted.length === 0) {
                                throw new NodeOperationError(this.getNode(), 'Select at least one Accepted Payment Method for a pending-payment order.', { itemIndex: i });
                            }
                            payment.accepted_methods = accepted as string[];
                        } else {
                            throw new NodeOperationError(this.getNode(), `Unsupported Payment Status "${payStatus}".`, { itemIndex: i });
                        }
                        body = {
                            customer: { id: customerIdNumber },
                            products,
                            payment,
                        };
                        const deliveryMethod = this.getNodeParameter('orderDeliveryMethod', i);
                        if (deliveryMethod) {
                            body.delivery_method = String(deliveryMethod);
                        }
                        if (extra.coupon_code)
                            body.coupon_code = extra.coupon_code;
                        if (extra.branch_id)
                            body.branch_id = Number(extra.branch_id);
                        if (deliveryMethod === 'pickup' && !extra.branch_id) {
                            throw new NodeOperationError(this.getNode(), 'Branch is required when Delivery Method is Pickup.', { itemIndex: i });
                        }
                        if (deliveryMethod === 'shipping') {
                            const courierId = Number(this.getNodeParameter('orderCourierId', i, ''));
                            const shipTo: IDataObject = {
                                ...asNodeParameters(this.getNodeParameter('orderShipTo', i, {})),
                            };
                            if (!Number.isSafeInteger(courierId) || courierId <= 0) {
                                throw new NodeOperationError(this.getNode(), 'Courier is required when Delivery Method is Shipping.', { itemIndex: i });
                            }
                            const requiredAddressFields = [
                                ['country', 'Country ID'],
                                ['city', 'City ID'],
                                ['block', 'Block / District Name'],
                                ['street_number', 'Street Number'],
                                ['address', 'Address'],
                                ['address_line', 'Address Line'],
                                ['postal_code', 'Postal Code'],
                            ];
                            const missingAddressFields = requiredAddressFields
                                .filter(([field]) => shipTo[field] === undefined || shipTo[field] === null || String(shipTo[field]).trim() === '')
                                .map(([, label]) => label);
                            if (missingAddressFields.length > 0) {
                                throw new NodeOperationError(
                                    this.getNode(),
                                    `Shipping Address is missing: ${missingAddressFields.join(', ')}.`,
                                    { itemIndex: i },
                                );
                            }
                            for (const field of ['country', 'city', 'district']) {
                                if (shipTo[field] !== undefined && shipTo[field] !== '') {
                                    const value = Number(shipTo[field]);
                                    if (!Number.isSafeInteger(value) || value <= 0) {
                                        throw new NodeOperationError(this.getNode(), `Shipping Address ${field} must be a valid numeric Salla ID.`, { itemIndex: i });
                                    }
                                    shipTo[field] = value;
                                }
                            }
                            const hasLatitude = shipTo.latitude !== undefined && Number(shipTo.latitude) !== 0;
                            const hasLongitude = shipTo.longitude !== undefined && Number(shipTo.longitude) !== 0;
                            if (hasLatitude !== hasLongitude) {
                                throw new NodeOperationError(this.getNode(), 'Shipping Address requires both Latitude and Longitude when either is provided.', { itemIndex: i });
                            }
                            if (hasLatitude && hasLongitude) {
                                shipTo.geo_coordinates = {
                                    lat: Number(shipTo.latitude),
                                    lng: Number(shipTo.longitude),
                                };
                            }
                            delete shipTo.latitude;
                            delete shipTo.longitude;
                            for (const [key, value] of Object.entries(shipTo)) {
                                if (value === '' || value === undefined || value === null)
                                    delete shipTo[key];
                            }
                            body.courier_id = courierId;
                            body.ship_to = shipTo;
                        }
                        // ── Product Create ──
                    }
                    else if (resource === 'product' && operation === 'create') {
                        body = {
                            name: this.getNodeParameter('productName', i),
                            price: this.getNodeParameter('productPrice', i),
                            product_type: this.getNodeParameter('productType', i),
                            quantity: this.getNodeParameter('productQuantity', i),
                            description: this.getNodeParameter('productDescription', i),
                            require_shipping: this.getNodeParameter('productRequireShipping', i),
                        };
                        if (body.require_shipping)
                            body.weight = 0.1;
                        const sku = this.getNodeParameter('productSku', i);
                        if (sku)
                            body.sku = sku;
                        const salePrice = Number(this.getNodeParameter('productSalePrice', i));
                        if (salePrice > 0)
                            body.sale_price = salePrice;
                        // Additional Fields
                        const extra = asNodeParameters(
                            this.getNodeParameter('productAdditionalFields', i, {}),
                        );
                        // image_url is handled after product creation via file upload
                        if (Array.isArray(extra.categories) && extra.categories.length)
                            body.categories = extra.categories.map((category) => Number(category));
                        if (extra.brand_id)
                            body.brand_id = Number(extra.brand_id);
                        if (extra.cost_price)
                            body.cost_price = extra.cost_price;
                        if (extra.sale_end)
                            body.sale_end = extra.sale_end;
                        if (extra.weight)
                            body.weight = extra.weight;
                        if (extra.weight_type)
                            body.weight_type = extra.weight_type;
                        if (extra.status)
                            body.status = extra.status;
                        if (extra.with_tax !== undefined)
                            body.with_tax = extra.with_tax;
                        if (extra.mpn)
                            body.mpn = extra.mpn;
                        if (extra.gtin)
                            body.gtin = extra.gtin;
                        if (extra.min_amount_donating)
                            body.min_amount_donating = extra.min_amount_donating;
                        if (extra.max_amount_donating)
                            body.max_amount_donating = extra.max_amount_donating;
                        if (extra.promotion_title || extra.promotion_sub_title) {
                            const promotion: IDataObject = {};
                            if (extra.promotion_title)
                                promotion.title = extra.promotion_title;
                            if (extra.promotion_sub_title)
                                promotion.sub_title = extra.promotion_sub_title;
                            body.promotion = promotion;
                        }
                        if (extra.metadata_title || extra.metadata_description || extra.metadata_url) {
                            const metadata: IDataObject = {};
                            if (extra.metadata_title)
                                metadata.title = extra.metadata_title;
                            if (extra.metadata_description)
                                metadata.description = extra.metadata_description;
                            if (extra.metadata_url)
                                metadata.url = extra.metadata_url;
                            body.metadata = metadata;
                        }
                        // ── Product Update ──
                    }
                    else if (resource === 'product' && operation === 'update') {
                        const fields: IDataObject = {
                            ...asNodeParameters(this.getNodeParameter('productUpdateFields', i, {})),
                        };
                        if (Array.isArray(fields.categories) && fields.categories.length)
                            fields.categories = fields.categories.map((category) => Number(category));
                        if (fields.brand_id)
                            fields.brand_id = Number(fields.brand_id);
                        if (fields.promotion_title || fields.promotion_sub_title) {
                            const promotion: IDataObject = {};
                            if (fields.promotion_title) {
                                promotion.title = fields.promotion_title;
                                delete fields.promotion_title;
                            }
                            if (fields.promotion_sub_title) {
                                promotion.sub_title = fields.promotion_sub_title;
                                delete fields.promotion_sub_title;
                            }
                            fields.promotion = promotion;
                        }
                        if (fields.metadata_title || fields.metadata_description || fields.metadata_url) {
                            const metadata: IDataObject = {};
                            if (fields.metadata_title) {
                                metadata.title = fields.metadata_title;
                                delete fields.metadata_title;
                            }
                            if (fields.metadata_description) {
                                metadata.description = fields.metadata_description;
                                delete fields.metadata_description;
                            }
                            if (fields.metadata_url) {
                                metadata.url = fields.metadata_url;
                                delete fields.metadata_url;
                            }
                            fields.metadata = metadata;
                        }
                        body = fields;
                        // ── Customer Create ──
                    }
                    else if (resource === 'customer' && operation === 'create') {
                        const firstName = requireValue(this.getNodeParameter('customerFirstName', i), 'First Name', i);
                        const mobile = requireValue(this.getNodeParameter('customerMobile', i), 'Mobile', i);
                        const countryCode = requireValue(this.getNodeParameter('customerCountryCode', i), 'Mobile Country Code', i);
                        if (!/^\+\d{1,4}$/.test(countryCode)) {
                            throw new NodeOperationError(this.getNode(), 'Mobile Country Code must start with + and contain 1–4 digits, for example +966.', { itemIndex: i });
                        }
                        body = {
                            first_name: firstName,
                            mobile,
                            mobile_code_country: countryCode,
                        };
                        const lastName = this.getNodeParameter('customerLastName', i);
                        const email = this.getNodeParameter('customerEmail', i);
                        if (lastName)
                            body.last_name = lastName;
                        if (email)
                            body.email = email;
                        const extra = asNodeParameters(
                            this.getNodeParameter('customerAdditionalFields', i, {}),
                        );
                        if (extra.gender)
                            body.gender = extra.gender;
                        if (extra.birthday) {
                            validateDate(extra.birthday, 'Birthday', i);
                            body.birthday = extra.birthday;
                        }
                        if (extra.groups)
                            body.groups = csvToArray(extra.groups, false);
                        // ── Customer Update ──
                    }
                    else if (resource === 'customer' && operation === 'update') {
                        const fields: IDataObject = {
                            ...asNodeParameters(this.getNodeParameter('customerUpdateFields', i, {})),
                        };
                        if (fields.birthday)
                            validateDate(fields.birthday, 'Birthday', i);
                        if (fields.mobile_code_country && !/^\+\d{1,4}$/.test(String(fields.mobile_code_country))) {
                            throw new NodeOperationError(this.getNode(), 'Mobile Country Code must start with + and contain 1–4 digits, for example +966.', { itemIndex: i });
                        }
                        if (fields.groups)
                            fields.groups = csvToArray(fields.groups, false);
                        body = fields;
                        // ── Coupon Create ──
                    }
                    else if (resource === 'coupon' && operation === 'create') {
                        const code = requireValue(this.getNodeParameter('couponCode', i), 'Coupon Code', i);
                        const couponType = this.getNodeParameter('couponType', i);
                        const amount = Number(this.getNodeParameter('couponAmount', i));
                        const expiryDate = requireValue(this.getNodeParameter('couponExpiryDate', i), 'Expiry Date', i);
                        validateDate(expiryDate, 'Expiry Date', i);
                        if (!Number.isFinite(amount) || amount <= 0) {
                            throw new NodeOperationError(this.getNode(), 'Discount Amount must be greater than 0.', { itemIndex: i });
                        }
                        if (couponType === 'percentage' && amount > 100) {
                            throw new NodeOperationError(this.getNode(), 'Percentage discounts cannot be greater than 100.', { itemIndex: i });
                        }
                        body = {
                            code,
                            type: couponType,
                            amount,
                            free_shipping: this.getNodeParameter('couponFreeShipping', i),
                            exclude_sale_products: false,
                            expiry_date: expiryDate,
                        };
                        const sd = this.getNodeParameter('couponStartDate', i);
                        if (sd) {
                            validateDate(sd, 'Start Date', i);
                            if (sd > expiryDate) {
                                throw new NodeOperationError(this.getNode(), 'Start Date cannot be after Expiry Date.', { itemIndex: i });
                            }
                            body.start_date = sd;
                        }
                        const ma = Number(this.getNodeParameter('couponMaxAmount', i));
                        if (ma > 0)
                            body.maximum_amount = ma;
                        const extra = asNodeParameters(
                            this.getNodeParameter('couponAdditionalFields', i, {}),
                        );
                        if (extra.exclude_sale_products !== undefined)
                            body.exclude_sale_products = extra.exclude_sale_products;
                        if (extra.usage_limit)
                            body.usage_limit = extra.usage_limit;
                        if (extra.usage_limit_per_user)
                            body.usage_limit_per_user = extra.usage_limit_per_user;
                        if (extra.minimum_amount)
                            body.minimum_amount = extra.minimum_amount;
                        if (extra.is_apply_with_offer !== undefined)
                            body.is_apply_with_offer = extra.is_apply_with_offer;
                        if (extra.applied_in)
                            body.applied_in = extra.applied_in;
                        if (extra.include_product_ids)
                            body.include_product_ids = csvToArray(extra.include_product_ids, false);
                        if (extra.exclude_product_ids)
                            body.exclude_product_ids = csvToArray(extra.exclude_product_ids, false);
                        if (extra.include_category_ids)
                            body.include_category_ids = csvToArray(extra.include_category_ids, false);
                        if (extra.exclude_category_ids)
                            body.exclude_category_ids = csvToArray(extra.exclude_category_ids, false);
                        if (extra.include_customer_group_ids)
                            body.include_customer_group_ids = csvToArray(extra.include_customer_group_ids, false);
                        if (extra.exclude_customer_group_ids)
                            body.exclude_customer_group_ids = csvToArray(extra.exclude_customer_group_ids, false);
                        if (Array.isArray(extra.exclude_brands_ids) && extra.exclude_brands_ids.length)
                            body.exclude_brands_ids = extra.exclude_brands_ids.map((brand) => Number(brand));
                        if (extra.include_payment_methods)
                            body.include_payment_methods = csvToArray(extra.include_payment_methods, false);
                        // ── Coupon Update ──
                    }
                    else if (resource === 'coupon' && operation === 'update') {
                        const fields: IDataObject = {
                            ...asNodeParameters(this.getNodeParameter('couponUpdateFields', i, {})),
                        };
                        if (Object.prototype.hasOwnProperty.call(fields, 'amount')) {
                            const amount = Number(fields.amount);
                            if (!Number.isFinite(amount) || amount <= 0) {
                                throw new NodeOperationError(this.getNode(), 'Coupon Amount must be greater than 0.', { itemIndex: i });
                            }
                            if (fields.type === 'percentage' && amount > 100) {
                                throw new NodeOperationError(this.getNode(), 'Percentage discounts cannot be greater than 100.', { itemIndex: i });
                            }
                        }
                        if (fields.start_date)
                            validateDate(fields.start_date, 'Start Date', i);
                        if (fields.expiry_date)
                            validateDate(fields.expiry_date, 'Expiry Date', i);
                        if (fields.start_date && fields.expiry_date
                            && String(fields.start_date) > String(fields.expiry_date)) {
                            throw new NodeOperationError(this.getNode(), 'Start Date cannot be after Expiry Date.', { itemIndex: i });
                        }
                        const csvFields = ['include_product_ids', 'exclude_product_ids', 'include_category_ids', 'exclude_category_ids',
                            'include_customer_group_ids', 'exclude_customer_group_ids', 'include_payment_methods'];
                        for (const f of csvFields) {
                            if (fields[f])
                                fields[f] = csvToArray(fields[f], false);
                        }
                        if (Array.isArray(fields.exclude_brands_ids) && fields.exclude_brands_ids.length) {
                            fields.exclude_brands_ids = fields.exclude_brands_ids.map((brand) => Number(brand));
                        }
                        body = fields;
                        // ── Brand Create ──
                    }
                    else if (resource === 'brand' && operation === 'create') {
                        const name = requireValue(this.getNodeParameter('brandName', i), 'Brand Name', i);
                        const logoUrl = requireValue(this.getNodeParameter('brandLogo', i), 'Logo URL', i);
                        if (!/^https?:\/\//i.test(logoUrl)) {
                            throw new NodeOperationError(this.getNode(), 'Logo URL must be an absolute http:// or https:// image URL.', { itemIndex: i });
                        }
                        body = {
                            name,
                            logo_url: logoUrl,
                        };
                        const extra = asNodeParameters(
                            this.getNodeParameter('brandAdditionalFields', i, {}),
                        );
                        if (extra.description)
                            body.description = extra.description;
                        if (extra.banner)
                            body.banner = extra.banner;
                        if (extra.status)
                            body.status = extra.status;
                        if (extra.metadata_title)
                            body.metadata_title = extra.metadata_title;
                        if (extra.metadata_description)
                            body.metadata_description = extra.metadata_description;
                        if (extra.metadata_url)
                            body.metadata_url = extra.metadata_url;
                        // Use upload proxy to handle logo file upload
                        url = `${API}/api/v1/salla-upload/brands`;
                        method = 'POST';
                        // ── Brand Update ──
                    }
                    else if (resource === 'brand' && operation === 'update') {
                        const fields: IDataObject = {
                            ...asNodeParameters(this.getNodeParameter('brandUpdateFields', i, {})),
                        };
                        body = fields;
                        // Use upload proxy if logo_url is provided
                        if (fields.logo_url) {
                            if (!/^https?:\/\//i.test(String(fields.logo_url))) {
                                throw new NodeOperationError(this.getNode(), 'Logo URL must be an absolute http:// or https:// image URL.', { itemIndex: i });
                            }
                            const brandId = requireValue(this.getNodeParameter(idF[resource], i), 'Brand ID', i);
                            url = `${API}/api/v1/salla-upload/brands/${encodeURIComponent(brandId)}`;
                            method = 'PUT';
                        }
                        // ── Category Create ──
                    }
                    else if (resource === 'category' && operation === 'create') {
                        body = { name: requireValue(this.getNodeParameter('categoryName', i), 'Category Name', i) };
                        const extra = asNodeParameters(
                            this.getNodeParameter('categoryAdditionalFields', i, {}),
                        );
                        if (extra.parent_id)
                            body.parent_id = Number(extra.parent_id);
                        if (extra.image)
                            body.image = extra.image;
                        if (extra.status)
                            body.status = extra.status;
                        if (extra.metadata_title)
                            body.metadata_title = extra.metadata_title;
                        if (extra.metadata_description)
                            body.metadata_description = extra.metadata_description;
                        if (extra.metadata_url)
                            body.metadata_url = extra.metadata_url;
                        // ── Category Update ──
                    }
                    else if (resource === 'category' && operation === 'update') {
                        body = {
                            ...asNodeParameters(this.getNodeParameter('categoryUpdateFields', i, {})),
                        };
                    }
                    if (!useCustom && operation === 'update' && ['customer', 'coupon', 'brand', 'category'].includes(resource) && !hasFields(body)) {
                        throw new NodeOperationError(
                            this.getNode(),
                            `Add at least one ${resource} field to update, or turn on Use Advanced JSON.`,
                            { itemIndex: i },
                        );
                    }
                    if (!url) {
                        if (operation === 'create') {
                            url = `${API}/api/v1/salla/${base}`;
                            method = 'POST';
                        }
                        else {
                            const id = requireValue(this.getNodeParameter(idF[resource], i), `${resource} ID`, i);
                            url = `${API}/api/v1/salla/${base}/${encodeURIComponent(id)}`;
                            method = 'PUT';
                        }
                    }
                }
                if (resource === 'customApiCall') {
                    const customMethod = this.getNodeParameter(
                        'customMethod',
                        i,
                    ) as IHttpRequestMethods;
                    let endpoint = (this.getNodeParameter('customEndpoint', i) as string).trim();
                    if (!endpoint) {
                        throw new NodeOperationError(this.getNode(), 'Endpoint is required, for example /orders or /customers/123.', { itemIndex: i });
                    }
                    if (/^https?:\/\//i.test(endpoint)) {
                        throw new NodeOperationError(this.getNode(), 'Endpoint must be a Salla path such as /orders, not a full URL.', { itemIndex: i });
                    }
                    if (endpoint.includes('?')) {
                        throw new NodeOperationError(this.getNode(), 'Put query parameters in Query Parameters, not inside Endpoint.', { itemIndex: i });
                    }
                    if (!endpoint.startsWith('/')) endpoint = '/' + endpoint;
                    const queryStr = (this.getNodeParameter('customQuery', i, '') as string).trim();
                    url = `${API}/api/v1/salla${endpoint}${queryStr ? '?' + queryStr : ''}`;
                    method = customMethod;
                    if (['POST', 'PUT', 'PATCH'].includes(method)) {
                        body = parseJsonObject(this.getNodeParameter('customBody', i), 'JSON Body', this.getNode(), i);
                    }
                }
                if (!url)
                    throw new NodeOperationError(this.getNode(), `Unsupported: ${resource}/${operation}`, { itemIndex: i });
                const opts: IHttpRequestOptions = { method, url, headers: hdr };
                if (body)
                    opts.body = body;
                if (!preFetched) {
                    r = await sallaRequest(opts, { itemIndex: i, ctx: `${method} ${resource}/${operation}` });
                }
                const response = r as IDataObject;
                // Return All: auto-paginate subsequent pages and concatenate results
                if (!preFetched && operation === 'getAll' && this.getNodeParameter('returnAll', i, false) === true && Array.isArray(response.data)) {
                    const maxPages = 500;
                    const pagination = asDataObject(response.pagination ?? {});
                    let collected = response.data as IDataObject[];
                    let currentPage = Number(pagination.currentPage || 1);
                    const totalPages = Number(pagination.totalPages || 1);
                    while (currentPage < totalPages && currentPage < maxPages) {
                        currentPage++;
                        const nextUrl = url.replace(/([?&])page=\d+/, `$1page=${currentPage}`);
                        const nextR = await sallaRequest(
                            { ...opts, url: nextUrl },
                            { itemIndex: i, readContext: 'pagination' },
                        );
                        if (Array.isArray(nextR.data) && nextR.data.length > 0) {
                            collected = collected.concat(nextR.data as IDataObject[]);
                            response.data = collected;
                        } else {
                            break;
                        }
                    }
                    if (currentPage >= maxPages && totalPages > maxPages) {
                        throw new NodeOperationError(
                            this.getNode(),
                            `Return All stopped at the 500-page safety limit (${(response.data as IDataObject[]).length} results collected, ${totalPages} pages reported). Add filters or use Page mode.`,
                            { itemIndex: i },
                        );
                    }
                }
                // After product creation, upload image as file if image_url was provided
                const responseData = asDataObject(response.data ?? {});
                if (resource === 'product' && operation === 'create' && responseData.id) {
                    const extraFields = asNodeParameters(
                        this.getNodeParameter('productAdditionalFields', i, {}),
                    );
                    if (extraFields.image_url) {
                        try {
                            await this.helpers.httpRequestWithAuthentication.call(
                                this,
                                'sallaFlowApi',
                                {
                                    method: 'POST',
                                    url: `${API}/api/v1/salla-upload/products/${responseData.id}/images`,
                                    headers: hdr,
                                    body: { image_url: extraFields.image_url },
                                },
                            );
                        } catch (imgErr) {
                            this.logger.warn(
                                `Image upload failed after product ${responseData.id} was created`,
                                { error: imgErr },
                            );
                        }
                    }
                }

                if (operation === 'getAll' && Array.isArray(response.data)) {
                    if (response.data.length === 0) {
                        ret.push({
                            json: { data: [], message: 'No items found', pagination: response.pagination || {} },
                            pairedItem: { item: i },
                        });
                    } else {
                        for (const d of response.data)
                            ret.push({ json: asDataObject(d), pairedItem: { item: i } });
                    }
                }
                else if (response.data !== undefined)
                    ret.push({ json: asDataObject(response.data), pairedItem: { item: i } });
                else
                    ret.push({ json: response, pairedItem: { item: i } });
            }
            catch (e) {
                // sallaRequest throws NodeOperationError with a pre-cleaned message.
                // Respect continueOnFail for both NodeOperationError and any stray raw errors.
                let cleanMsg;
                if (e instanceof NodeOperationError) {
                    cleanMsg = e.message;
                } else {
                    // Sanitize: axios/httpRequest errors carry sockets/agent refs that break JSON.stringify
                    // ("Converting circular structure to JSON"). Extract a clean message before rethrowing.
                    const sallaResp = e?.response?.data || e?.cause?.response?.data || e?.body;
                    cleanMsg = e?.message || 'Unknown error';
                    if (sallaResp) {
                        const d = typeof sallaResp === 'string'
                            ? (() => { try { return JSON.parse(sallaResp); } catch { return { raw: sallaResp }; } })()
                            : sallaResp;
                        const eObj = d?.error;
                        if (eObj && typeof eObj === 'object') cleanMsg = eObj.message || cleanMsg;
                        else if (typeof eObj === 'string') cleanMsg = d?.message || eObj;
                        else if (d?.message) cleanMsg = d.message;
                    }
                    const status = e?.response?.status || e?.statusCode;
                    if (status) cleanMsg = `[${status}] ${cleanMsg}`;
                }
                if (this.continueOnFail()) {
                    ret.push({ json: { error: cleanMsg }, pairedItem: { item: i } });
                    continue;
                }
                throw new NodeOperationError(this.getNode(), cleanMsg, { itemIndex: i });
            }
        }
        return [ret];
    }
}
export {
    SallaFlow,
    csvToArray,
    fetchPaginated,
    formatFieldErrors,
    hasFields,
    logicalRequestId,
    normalizeInventoryItems,
    normalizeSallaError,
    parseJsonArray,
    parseJsonInput,
    parseJsonObject,
    readTelemetryHeaders,
    withReadTelemetry,
};
