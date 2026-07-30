"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SallaFlowApi = void 0;
class SallaFlowApi {
    constructor() {
        this.name = 'sallaFlowApi';
        this.displayName = 'SallaFlow API';
        this.icon = { light: 'file:icon.svg', dark: 'file:icon.dark.svg' };
        this.documentationUrl = 'https://github.com/MoMorgan1/n8n-nodes-sallaflow#credentials';
        this.properties = [
            { displayName: 'API Key', name: 'apiKey', type: 'string', typeOptions: { password: true }, default: '', required: true,
                description: 'Your SallaFlow API key from the merchant dashboard.' },
        ];
        this.authenticate = { type: 'generic', properties: { headers: { 'X-SallaFlow-Key': '={{$credentials.apiKey}}' } } };
        this.test = { request: { baseURL: 'https://api.sallaflow.cloud', url: '/api/v1/me', method: 'GET' } };
    }
}
exports.SallaFlowApi = SallaFlowApi;
//# sourceMappingURL=SallaFlowApi.credentials.js.map