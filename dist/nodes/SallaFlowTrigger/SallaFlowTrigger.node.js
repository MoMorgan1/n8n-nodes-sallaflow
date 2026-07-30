"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SallaFlowTrigger = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const SALLAFLOW_API = 'https://api.sallaflow.cloud';
// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool -- Trigger nodes cannot execute as AI tools.
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
                        // ── Orders ──
                        { name: 'Order Created', value: 'order.created' },
                        { name: 'Order Updated', value: 'order.updated' },
                        { name: 'Order Status Updated', value: 'order.status.updated' },
                        { name: 'Order Cancelled', value: 'order.cancelled' },
                        { name: 'Order Refunded', value: 'order.refunded' },
                        { name: 'Order Deleted', value: 'order.deleted' },
                        { name: 'Order Products Updated', value: 'order.products.updated' },
                        { name: 'Order Payment Updated', value: 'order.payment.updated' },
                        { name: 'Order Coupon Updated', value: 'order.coupon.updated' },
                        { name: 'Order Total Price Updated', value: 'order.total.price.updated' },
                        { name: 'Order Shipment Creating', value: 'order.shipment.creating' },
                        { name: 'Order Shipment Created', value: 'order.shipment.created' },
                        { name: 'Order Shipment Cancelled', value: 'order.shipment.cancelled' },
                        { name: 'Order Shipment Return Creating', value: 'order.shipment.return.creating' },
                        { name: 'Order Shipment Return Created', value: 'order.shipment.return.created' },
                        { name: 'Order Shipment Return Cancelled', value: 'order.shipment.return.cancelled' },
                        { name: 'Order Shipping Address Updated', value: 'order.shipping.address.updated' },
                        // ── Products ──
                        { name: 'Product Created', value: 'product.created' },
                        { name: 'Product Updated (Deprecated)', value: 'product.updated',
                            description: 'Deprecated by Salla. Prefer the specific product update events below.' },
                        { name: 'Product Deleted', value: 'product.deleted' },
                        { name: 'Product Available (Deprecated)', value: 'product.available',
                            description: 'Deprecated by Salla. Prefer Product Status Updated.' },
                        { name: 'Product Quantity Low', value: 'product.quantity.low' },
                        { name: 'Product Channels Changed', value: 'product.channels.changed' },
                        { name: 'Product Price Updated', value: 'product.price.updated' },
                        { name: 'Product Status Updated', value: 'product.status.updated' },
                        { name: 'Product Image Updated', value: 'product.image.updated' },
                        { name: 'Product Category Updated', value: 'product.category.updated' },
                        { name: 'Product Brand Updated', value: 'product.brand.updated' },
                        { name: 'Product Tags Updated', value: 'product.tags.updated' },
                        // ── Customers ──
                        { name: 'Customer Created', value: 'customer.created' },
                        { name: 'Customer Updated', value: 'customer.updated' },
                        { name: 'Customer Login', value: 'customer.login' },
                        { name: 'Customer OTP Request Failed', value: 'customer.otp.request',
                            description: 'Triggered only when both email and SMS OTP delivery attempts fail' },
                        // ── Brands ──
                        { name: 'Brand Created', value: 'brand.created' },
                        { name: 'Brand Updated', value: 'brand.updated' },
                        { name: 'Brand Deleted', value: 'brand.deleted' },
                        // ── Categories ──
                        { name: 'Category Created', value: 'category.created' },
                        { name: 'Category Updated', value: 'category.updated' },
                        // ── Coupons ──
                        { name: 'Coupon Created', value: 'coupon.created' },
                        { name: 'Coupon Updated', value: 'coupon.updated' },
                        { name: 'Coupon Applied', value: 'coupon.applied' },
                        // ── Cart ──
                        { name: 'Abandoned Cart', value: 'abandoned.cart' },
                        { name: 'Abandoned Cart Updated', value: 'abandoned.cart.updated' },
                        { name: 'Abandoned Cart Status Changed', value: 'abandoned.cart.status.changed' },
                        { name: 'Abandoned Cart Purchased', value: 'abandoned.cart.purchased' },
                        // ── Shipments ──
                        { name: 'Shipment Creating', value: 'shipment.creating' },
                        { name: 'Shipment Created', value: 'shipment.created' },
                        { name: 'Shipment Cancelled', value: 'shipment.cancelled' },
                        { name: 'Shipment Updated', value: 'shipment.updated' },
                        { name: 'Shipment Return Creating (Deprecated Alias)', value: 'shipment.return.creating',
                            description: 'Legacy SallaFlow value retained for saved workflows. New workflows should use Order Shipment Return Creating.' },
                        // ── Shipping Companies and Zones ──
                        { name: 'Shipping Zone Created', value: 'shipping.zone.created' },
                        { name: 'Shipping Zone Updated', value: 'shipping.zone.updated' },
                        { name: 'Shipping Company Created', value: 'shipping.company.created' },
                        { name: 'Shipping Company Updated', value: 'shipping.company.updated' },
                        { name: 'Shipping Company Deleted', value: 'shipping.company.deleted' },
                        // ── Reviews ──
                        { name: 'Review Added', value: 'review.added' },
                        // ── Special Offers ──
                        { name: 'Special Offer Created', value: 'specialoffer.created' },
                        { name: 'Special Offer Updated', value: 'specialoffer.updated' },
                        // ── Store Branches ──
                        { name: 'Store Branch Created', value: 'store.branch.created' },
                        { name: 'Store Branch Updated', value: 'store.branch.updated' },
                        { name: 'Store Branch Default Set', value: 'store.branch.setDefault' },
                        { name: 'Store Branch Activated', value: 'store.branch.activated' },
                        { name: 'Store Branch Deleted', value: 'store.branch.deleted' },
                        { name: 'Store Tax Created', value: 'storetax.created' },
                        // ── Invoices ──
                        { name: 'Invoice Created', value: 'invoice.created' },
                    ],
                    default: 'order.created', required: true, description: 'The Salla event to listen for',
                }],
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