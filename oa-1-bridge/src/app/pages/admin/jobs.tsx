import { env } from "cloudflare:workers";

export interface WebhookData {
    deliveryId: string;
    eventType: string;
    timestamp: number;
    username: string;
    payload: any;
    status: "queued" | "fallback";
}

export const JobsPage = async () => {
    const recentWebhooksJson = await env.JOBS.get("webhooks:recent");
    const recentIds: string[] = recentWebhooksJson ? JSON.parse(recentWebhooksJson) : [];

    const webhooks = (
        await Promise.all(
            recentIds.map(async (id) => {
                const data = await env.JOBS.get(`webhook:${id}`);
                return data ? (JSON.parse(data) as WebhookData) : null;
            })
        )
    ).filter((h): h is WebhookData => h !== null);

    return (
        <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
            <h1>GitHub Webhooks</h1>
            <table
                style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}
            >
                <thead>
                    <tr style={{ textAlign: "left", borderBottom: "2px solid #eee" }}>
                        <th style={{ padding: "0.5rem" }}>Delivery ID</th>
                        <th style={{ padding: "0.5rem" }}>Event</th>
                        <th style={{ padding: "0.5rem" }}>Time</th>
                        <th style={{ padding: "0.5rem" }}>User</th>
                        <th style={{ padding: "0.5rem" }}>Status</th>
                    </tr>
                </thead>
                <tbody>
                    {webhooks.map((hook) => (
                        <tr key={hook.deliveryId} style={{ borderBottom: "1px solid #eee" }}>
                            <td style={{ padding: "0.5rem", fontSize: "0.8rem" }}>
                                {hook.deliveryId}
                            </td>
                            <td style={{ padding: "0.5rem" }}>{hook.eventType}</td>
                            <td style={{ padding: "0.5rem" }}>
                                {new Date(hook.timestamp).toLocaleString()}
                            </td>
                            <td style={{ padding: "0.5rem" }}>{hook.username}</td>
                            <td style={{ padding: "0.5rem" }}>
                                <span
                                    style={{
                                        padding: "2px 8px",
                                        borderRadius: "12px",
                                        fontSize: "0.8rem",
                                        backgroundColor:
                                            hook.status === "queued" ? "#e6fffa" : "#fff5f5",
                                        color: hook.status === "queued" ? "#2c7a7b" : "#c53030",
                                    }}
                                >
                                    {hook.status}
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {webhooks.length === 0 && <p>No webhooks received yet.</p>}
        </div>
    );
};
