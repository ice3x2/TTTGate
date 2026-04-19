import http from "http";

type HttpRequestOptions = {
    port: number;
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}

type HttpResponse = {
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    body: string;
}

const httpRequest = async (options: HttpRequestOptions): Promise<HttpResponse> => {
    return new Promise<HttpResponse>((resolve, reject) => {
        const request = http.request({
            host: "127.0.0.1",
            port: options.port,
            path: options.path,
            method: options.method ?? "GET",
            headers: options.headers
        }, (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            response.on("end", () => {
                resolve({
                    statusCode: response.statusCode ?? 0,
                    headers: response.headers,
                    body: Buffer.concat(chunks).toString("utf-8")
                });
            });
        });

        request.on("error", reject);

        if(options.body) {
            request.write(options.body);
        }

        request.end();
    });
};

export { httpRequest, HttpRequestOptions, HttpResponse };
