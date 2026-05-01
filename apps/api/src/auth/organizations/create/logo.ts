type OrganizationLogoInput = {
	contentType: string;
	data: string;
};

type OrganizationLogoStorage = {
	put: (
		key: string,
		value: Uint8Array,
		options: {
			httpMetadata: {
				contentType: string;
			};
		},
	) => Promise<{ key: string }>;
};

function decodeBase64LogoData(data: string): Uint8Array {
	let binary: string;

	try {
		binary = atob(data);
	} catch {
		throw new Error("Organization logo data must be base64 encoded.");
	}

	const bytes = new Uint8Array(binary.length);

	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}

	return bytes;
}

function createLogoUrl(key: string): string {
	return process.env.NODE_ENV === "production"
		? `https://cdn.kayle.id/${key}`
		: `http://127.0.0.1:8787/r2/${key}`;
}

export async function uploadOrganizationLogo({
	logo,
	storage,
}: {
	logo: OrganizationLogoInput;
	storage: OrganizationLogoStorage | null | undefined;
}): Promise<string> {
	const bytes = decodeBase64LogoData(logo.data);

	if (!storage) {
		throw new Error("Organization logo storage is unavailable.");
	}

	const logoData = await storage.put(`logos/${crypto.randomUUID()}`, bytes, {
		httpMetadata: {
			contentType: logo.contentType,
		},
	});

	return createLogoUrl(logoData.key);
}
