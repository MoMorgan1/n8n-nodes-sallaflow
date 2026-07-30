import type { IDataObject, IExecuteFunctions, IHttpRequestOptions, ILoadOptionsFunctions, INode, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
declare function csvToArray(val: unknown, asNumber?: boolean): Array<string | number>;
declare function parseJsonInput(raw: unknown, node: INode, itemIndex: number, label: string): unknown;
declare function normalizeInventoryItems(raw: unknown, node: INode, itemIndex: number): IDataObject[];
declare function formatFieldErrors(fields: unknown): string;
declare function normalizeSallaError(requestError: unknown, retryStatuses?: ReadonlySet<number>): {
    msg: string;
    fields: IDataObject;
    code: string;
    status: number | undefined;
    retryable: boolean;
};
declare function parseJsonObject(value: unknown, label: string, node: INode, itemIndex: number): IDataObject;
declare function parseJsonArray(value: unknown, label: string, node: INode, itemIndex: number): unknown[];
declare function hasFields(value: unknown): boolean;
declare function logicalRequestId(): string;
declare function readTelemetryHeaders(context: string): {
    'X-SallaFlow-Logical-Request-Id': string;
    'X-SallaFlow-Read-Context': string;
};
declare function withReadTelemetry(options: IHttpRequestOptions, context: string): IHttpRequestOptions;
declare function fetchPaginated(context: ILoadOptionsFunctions, endpoint: string, perPage?: number): Promise<IDataObject[]>;
declare class SallaFlow implements INodeType {
    description: INodeTypeDescription;
    methods: NonNullable<INodeType['methods']>;
    execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]>;
}
export { SallaFlow, csvToArray, fetchPaginated, formatFieldErrors, hasFields, logicalRequestId, normalizeInventoryItems, normalizeSallaError, parseJsonArray, parseJsonInput, parseJsonObject, readTelemetryHeaders, withReadTelemetry, };
//# sourceMappingURL=SallaFlow.node.d.ts.map