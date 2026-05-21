interface CloudflareR2BucketUsage {
	end?: string;
	metadataSize?: number;
	payloadSize?: number;
}

interface CloudflareR2UsageResponse {
	result?: CloudflareR2BucketUsage | null;
	success?: boolean;
}

interface CloudflareD1DatabaseInfo {
	file_size?: number;
	num_tables?: number;
}

interface CloudflareD1DatabaseResponse {
	result?: CloudflareD1DatabaseInfo | null;
	success?: boolean;
}

interface CloudflareKvNamespaceInfo {
	id?: string;
	storage_bytes?: number;
	title?: string;
}

interface CloudflareKvResultInfo {
	count?: number;
	page?: number;
	per_page?: number;
	total_count?: number;
	total_pages?: number;
}

interface CloudflareKvNamespacesResponse {
	result?: CloudflareKvNamespaceInfo[];
	result_info?: CloudflareKvResultInfo;
	success?: boolean;
}

interface CloudflareApiParams {
	accountId: string;
	apiToken: string;
}

const KV_NAMESPACE_PAGE_LIMIT = 50;
const KV_NAMESPACES_PER_PAGE = 100;

export async function fetchR2BucketBytes({
	accountId,
	apiToken,
	bucketName,
}: CloudflareApiParams & { bucketName: string }): Promise<number | null> {
	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/usage`;
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${apiToken}` },
	});
	if (!response.ok) {
		return null;
	}

	const body = (await response
		.json()
		.catch(() => null)) as CloudflareR2UsageResponse | null;
	if (!body?.success || !body.result) {
		return null;
	}

	const payload = body.result.payloadSize ?? 0;
	const metadata = body.result.metadataSize ?? 0;
	const total = payload + metadata;
	return Number.isFinite(total) ? total : null;
}

export async function fetchD1DatabaseBytes({
	accountId,
	apiToken,
	databaseId,
}: CloudflareApiParams & { databaseId: string }): Promise<number | null> {
	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`;
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${apiToken}` },
	});
	if (!response.ok) {
		return null;
	}

	const body = (await response
		.json()
		.catch(() => null)) as CloudflareD1DatabaseResponse | null;
	const size = body?.success ? body.result?.file_size : undefined;
	return typeof size === "number" && Number.isFinite(size) ? size : null;
}

export async function fetchKvNamespaceBytes({
	accountId,
	apiToken,
	namespaceId,
}: CloudflareApiParams & { namespaceId: string }): Promise<number | null> {
	for (let page = 1; page <= KV_NAMESPACE_PAGE_LIMIT; page += 1) {
		const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces?per_page=${KV_NAMESPACES_PER_PAGE}&page=${page}`;
		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${apiToken}` },
		});
		if (!response.ok) {
			return null;
		}

		const body = (await response
			.json()
			.catch(() => null)) as CloudflareKvNamespacesResponse | null;
		if (!body?.success || !Array.isArray(body.result)) {
			return null;
		}

		const match = body.result.find((entry) => entry.id === namespaceId);
		if (match) {
			const bytes = match.storage_bytes;
			return typeof bytes === "number" && Number.isFinite(bytes) ? bytes : null;
		}

		const totalPages = body.result_info?.total_pages;
		const exhausted =
			(typeof totalPages === "number" && page >= totalPages) ||
			body.result.length === 0;
		if (exhausted) {
			return null;
		}
	}

	return null;
}
