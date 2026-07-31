"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SallaFlowTrigger = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const SALLAFLOW_API = 'https://api.sallaflow.cloud';
class SallaFlowTrigger {
    constructor() {
        this.description = {
            displayName: 'SallaFlow Trigger', name: 'sallaFlowTrigger',
            icon: { light: 'file:icon.svg', dark: 'file:icon.dark.svg' },
            group: ['trigger'], version: 2, subtitle: '={{$parameter["event"]}}',
            description: 'Triggers when a Salla store event occurs',
            defaults: { name: 'SallaFlow Trigger' },
            inputs: [], outputs: [n8n_workflow_1.NodeConnectionTypes.Main],
            credentials: [{ name: 'sallaFlowApi', required: true }],
            webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
            properties: [{
                    displayName: 'Event', name: 'event', type: 'options', noDataExpression: true,
                    options: [
                        { name: 'Abandoned Cart', value: 'abandoned.cart' },
                        { name: 'Abandoned Cart Purchased', value: 'abandoned.cart.purchased' },
                        { name: 'Abandoned Cart Status Changed', value: 'abandoned.cart.status.changed' },
                        { name: 'Abandoned Cart Updated', value: 'abandoned.cart.updated' },
                        { name: 'Brand Created', value: 'brand.created' },
                        { name: 'Brand Deleted', value: 'brand.deleted' },
                        { name: 'Brand Updated', value: 'brand.updated' },
                        { name: 'Category Created', value: 'category.created' },
                        { name: 'Category Updated', value: 'category.updated' },
                        { name: 'Coupon Applied', value: 'coupon.applied' },
                        { name: 'Coupon Created', value: 'coupon.created' },
                        { name: 'Coupon Updated', value: 'coupon.updated' },
                        { name: 'Customer Created', value: 'customer.created' },
                        { name: 'Customer Login', value: 'customer.login' },
                        { name: 'Customer OTP Request Failed', value: 'customer.otp.request',
                            description: 'Triggered only when both email and SMS OTP delivery attempts fail' },
                        { name: 'Customer Updated', value: 'customer.updated' },
                        { name: 'Invoice Created', value: 'invoice.created' },
                        { name: 'Order Cancelled', value: 'order.cancelled' },
                        { name: 'Order Coupon Updated', value: 'order.coupon.updated' },
                        { name: 'Order Created', value: 'order.created' },
                        { name: 'Order Deleted', value: 'order.deleted' },
                        { name: 'Order Payment Updated', value: 'order.payment.updated' },
                        { name: 'Order Products Updated', value: 'order.products.updated' },
                        { name: 'Order Refunded', value: 'order.refunded' },
                        { name: 'Order Shipment Cancelled', value: 'order.shipment.cancelled' },
                        { name: 'Order Shipment Created', value: 'order.shipment.created' },
                        { name: 'Order Shipment Creating', value: 'order.shipment.creating' },
                        { name: 'Order Shipment Return Cancelled', value: 'order.shipment.return.cancelled' },
                        { name: 'Order Shipment Return Created', value: 'order.shipment.return.created' },
                        { name: 'Order Shipment Return Creating', value: 'order.shipment.return.creating' },
                        { name: 'Order Shipping Address Updated', value: 'order.shipping.address.updated' },
                        { name: 'Order Status Updated', value: 'order.status.updated' },
                        { name: 'Order Total Price Updated', value: 'order.total.price.updated' },
                        { name: 'Order Updated', value: 'order.updated' },
                        { name: 'Product Available (Deprecated)', value: 'product.available',
                            description: 'Deprecated by Salla. Prefer Product Status Updated.' },
                        { name: 'Product Brand Updated', value: 'product.brand.updated' },
                        { name: 'Product Category Updated', value: 'product.category.updated' },
                        { name: 'Product Channels Changed', value: 'product.channels.changed' },
                        { name: 'Product Created', value: 'product.created' },
                        { name: 'Product Deleted', value: 'product.deleted' },
                        { name: 'Product Image Updated', value: 'product.image.updated' },
                        { name: 'Product Price Updated', value: 'product.price.updated' },
                        { name: 'Product Quantity Low', value: 'product.quantity.low' },
                        { name: 'Product Status Updated', value: 'product.status.updated' },
                        { name: 'Product Tags Updated', value: 'product.tags.updated' },
                        { name: 'Product Updated (Deprecated)', value: 'product.updated',
                            description: 'Deprecated by Salla. Prefer the specific product update events below.' },
                        { name: 'Review Added', value: 'review.added' },
                        { name: 'Shipment Cancelled', value: 'shipment.cancelled' },
                        { name: 'Shipment Created', value: 'shipment.created' },
                        { name: 'Shipment Creating', value: 'shipment.creating' },
                        { name: 'Shipment Return Creating (Deprecated Alias)', value: 'shipment.return.creating',
                            description: 'Legacy SallaFlow value retained for saved workflows. New workflows should use Order Shipment Return Creating.' },
                        { name: 'Shipment Updated', value: 'shipment.updated' },
                        { name: 'Shipping Company Created', value: 'shipping.company.created' },
                        { name: 'Shipping Company Deleted', value: 'shipping.company.deleted' },
                        { name: 'Shipping Company Updated', value: 'shipping.company.updated' },
                        { name: 'Shipping Zone Created', value: 'shipping.zone.created' },
                        { name: 'Shipping Zone Updated', value: 'shipping.zone.updated' },
                        { name: 'Special Offer Created', value: 'specialoffer.created' },
                        { name: 'Special Offer Updated', value: 'specialoffer.updated' },
                        { name: 'Store Branch Activated', value: 'store.branch.activated' },
                        { name: 'Store Branch Created', value: 'store.branch.created' },
                        { name: 'Store Branch Default Set', value: 'store.branch.setDefault' },
                        { name: 'Store Branch Deleted', value: 'store.branch.deleted' },
                        { name: 'Store Branch Updated', value: 'store.branch.updated' },
                        { name: 'Store Tax Created', value: 'storetax.created' },
                    ],
                    default: 'order.created', required: true, description: 'The Salla event to listen for',
                }],
            usableAsTool: undefined,
        };
        this.webhookMethods = {
            default: {
                async checkExists() {
                    const webhookUrl = this.getNodeWebhookUrl('default');
                    const event = this.getNodeParameter('event');
                    try {
                        const res = await this.helpers.httpRequestWithAuthentication.call(this, 'sallaFlowApi', {
                            method: 'GET',
                            url: `${SALLAFLOW_API}/api/v1/webhook-subscription`,
                        });
                        const subscriptions = Array.isArray(res.subscriptions)
                            ? res.subscriptions
                            : [];
                        if (res.success) {
                            return subscriptions.some((subscription) => (subscription.event === event
                                && subscription.n8n_webhook_url === webhookUrl));
                        }
                        return false;
                    }
                    catch {
                        this.logger.error('Unable to verify the SallaFlow webhook registration');
                        return false;
                    }
                },
                async create() {
                    const webhookUrl = this.getNodeWebhookUrl('default');
                    const event = this.getNodeParameter('event');
                    const res = await this.helpers.httpRequestWithAuthentication.call(this, 'sallaFlowApi', {
                        method: 'POST',
                        url: `${SALLAFLOW_API}/api/v1/webhook-subscription`,
                        body: { event, webhookUrl },
                    });
                    if (!res.success) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Failed to register webhook: ${JSON.stringify(res)}`);
                    }
                    return true;
                },
                async delete() {
                    const webhookUrl = this.getNodeWebhookUrl('default');
                    const event = this.getNodeParameter('event');
                    try {
                        await this.helpers.httpRequestWithAuthentication.call(this, 'sallaFlowApi', {
                            method: 'DELETE',
                            url: `${SALLAFLOW_API}/api/v1/webhook-subscription`,
                            body: { event, webhookUrl },
                        });
                    }
                    catch {
                        this.logger.error('Unable to remove the SallaFlow webhook registration');
                        // Remote cleanup must not prevent n8n from deactivating or deleting
                        // the workflow; an already-absent or unreachable subscription is
                        // treated as successfully torn down locally.
                    }
                    return true;
                },
            },
        };
    }
    async webhook() {
        const body = this.getBodyData();
        return { workflowData: [this.helpers.returnJsonArray(body)] };
    }
}
exports.SallaFlowTrigger = SallaFlowTrigger;
//# sourceMappingURL=SallaFlowTrigger.node.js.map