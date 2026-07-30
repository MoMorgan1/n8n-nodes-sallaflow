import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
  Icon,
} from 'n8n-workflow';

export class SallaFlowApi implements ICredentialType {
  name = 'sallaFlowApi';
  displayName = 'SallaFlow API';
  icon: Icon = { light: 'file:icon.svg', dark: 'file:icon.dark.svg' };
  documentationUrl = 'https://github.com/MoMorgan1/n8n-nodes-sallaflow#credentials';
  properties: INodeProperties[] = [
    { displayName: 'API Key', name: 'apiKey', type: 'string', typeOptions: { password: true }, default: '', required: true,
      description: 'Your SallaFlow API key from the merchant dashboard.' },
  ];
  authenticate: IAuthenticateGeneric = { type: 'generic', properties: { headers: { 'X-SallaFlow-Key': '={{$credentials.apiKey}}' } } };
  test: ICredentialTestRequest = { request: { baseURL: 'https://api.sallaflow.cloud', url: '/api/v1/me', method: 'GET' } };
}
