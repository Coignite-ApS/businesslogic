export interface SnippetParams {
	baseUrl: string;
	calculatorId: string;
	apiKey: string;
	sampleBody?: Record<string, unknown>;
}

export function maskToken(token: string): string {
	if (token.length <= 8) return '*'.repeat(token.length);
	return token.slice(0, 4) + '*'.repeat(token.length - 8) + token.slice(-4);
}

function jsonBody(body: Record<string, unknown>): string {
	return JSON.stringify(body, null, 2);
}

// --- curl ---

export function curlExecute({ baseUrl, calculatorId, apiKey, sampleBody }: SnippetParams): string {
	const body = sampleBody ? ` \\\n  -d '${jsonBody(sampleBody)}'` : '';
	return `curl -X POST "${baseUrl}/execute/calculator/${calculatorId}" \\
  -H "X-API-Key: ${apiKey}" \\
  -H "Content-Type: application/json"${body}`;
}

export function curlDescribe({ baseUrl, calculatorId, token }: SnippetParams): string {
	return `curl "${baseUrl}/calculator/${calculatorId}/describe" \\
  -H "X-API-Key: ${apiKey}"`;
}

// --- JavaScript (fetch) ---

export function jsExecute({ baseUrl, calculatorId, apiKey, sampleBody }: SnippetParams): string {
	const body = sampleBody ? `\n  body: JSON.stringify(${jsonBody(sampleBody)}),` : '';
	return `const response = await fetch("${baseUrl}/execute/calculator/${calculatorId}", {
  method: "POST",
  headers: {
    "X-API-Key": "${apiKey}",
    "Content-Type": "application/json",
  },${body}
});

const result = await response.json();
console.log(result);`;
}

export function jsDescribe({ baseUrl, calculatorId, token }: SnippetParams): string {
	return `const response = await fetch("${baseUrl}/calculator/${calculatorId}/describe", {
  headers: {
    "X-API-Key": "${apiKey}",
  },
});

const schema = await response.json();
console.log(schema);`;
}

// --- Python (requests) ---

export function pythonExecute({ baseUrl, calculatorId, apiKey, sampleBody }: SnippetParams): string {
	const body = sampleBody ? `\n\ndata = ${jsonBody(sampleBody)}` : '';
	const arg = sampleBody ? ', json=data' : '';
	return `import requests
${body}
response = requests.post(
    "${baseUrl}/execute/calculator/${calculatorId}",
    headers={"X-API-Key": "${apiKey}"}${arg}
)

print(response.json())`;
}

export function pythonDescribe({ baseUrl, calculatorId, token }: SnippetParams): string {
	return `import requests

response = requests.get(
    "${baseUrl}/calculator/${calculatorId}/describe",
    headers={"X-API-Key": "${apiKey}"}
)

print(response.json())`;
}

// --- PHP (cURL) ---

export function phpExecute({ baseUrl, calculatorId, apiKey, sampleBody }: SnippetParams): string {
	const body = sampleBody
		? `\n$data = json_encode(${jsonBody(sampleBody).replace(/"/g, "'").replace(/'/g, '"')});\n`
		: '';
	const opts = sampleBody
		? `\ncurl_setopt($ch, CURLOPT_POSTFIELDS, $data);\n`
		: '';
	return `<?php
$ch = curl_init("${baseUrl}/execute/calculator/${calculatorId}");
${body}
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "X-API-Key: ${apiKey}",
    "Content-Type: application/json",
]);${opts}
$response = curl_exec($ch);
curl_close($ch);

echo $response;`;
}

export function phpDescribe({ baseUrl, calculatorId, token }: SnippetParams): string {
	return `<?php
$ch = curl_init("${baseUrl}/calculator/${calculatorId}/describe");

curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "X-API-Key: ${apiKey}",
]);

$response = curl_exec($ch);
curl_close($ch);

echo $response;`;
}

// --- Go ---

export function goExecute({ baseUrl, calculatorId, apiKey, sampleBody }: SnippetParams): string {
	const bodySetup = sampleBody
		? `body := strings.NewReader(\`${jsonBody(sampleBody)}\`)\n\treq, err := http.NewRequest("POST", url, body)`
		: `req, err := http.NewRequest("POST", url, nil)`;
	return `package main

import (
	"fmt"
	"io"
	"net/http"${sampleBody ? '\n\t"strings"' : ''}
)

func main() {
	url := "${baseUrl}/execute/calculator/${calculatorId}"
	${bodySetup}
	if err != nil {
		panic(err)
	}

	req.Header.Set("X-API-Key", "${apiKey}")
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()

	result, _ := io.ReadAll(resp.Body)
	fmt.Println(string(result))
}`;
}

export function goDescribe({ baseUrl, calculatorId, token }: SnippetParams): string {
	return `package main

import (
	"fmt"
	"io"
	"net/http"
)

func main() {
	url := "${baseUrl}/calculator/${calculatorId}/describe"
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		panic(err)
	}

	req.Header.Set("X-API-Key", "${apiKey}")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()

	result, _ := io.ReadAll(resp.Body)
	fmt.Println(string(result))
}`;
}

// --- Rust (reqwest) ---

export function rustExecute({ baseUrl, calculatorId, apiKey, sampleBody }: SnippetParams): string {
	const bodyArg = sampleBody ? `.json(&serde_json::json!(${jsonBody(sampleBody)}))` : '';
	return `use reqwest;

#[tokio::main]
async fn main() -> Result<(), reqwest::Error> {
    let client = reqwest::Client::new();
    let res = client
        .post("${baseUrl}/execute/calculator/${calculatorId}")
        .header("X-API-Key", "${apiKey}")
        ${bodyArg}
        .send()
        .await?;

    let body = res.text().await?;
    println!("{}", body);
    Ok(())
}`;
}

export function rustDescribe({ baseUrl, calculatorId, token }: SnippetParams): string {
	return `use reqwest;

#[tokio::main]
async fn main() -> Result<(), reqwest::Error> {
    let client = reqwest::Client::new();
    let res = client
        .get("${baseUrl}/calculator/${calculatorId}/describe")
        .header("X-API-Key", "${apiKey}")
        .send()
        .await?;

    let body = res.text().await?;
    println!("{}", body);
    Ok(())
}`;
}

// --- Java (HttpClient) ---

export function javaExecute({ baseUrl, calculatorId, apiKey, sampleBody }: SnippetParams): string {
	const bodyPublisher = sampleBody
		? `HttpRequest.BodyPublishers.ofString("""\n            ${jsonBody(sampleBody)}""")`
		: `HttpRequest.BodyPublishers.noBody()`;
	return `import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

var client = HttpClient.newHttpClient();
var request = HttpRequest.newBuilder()
    .uri(URI.create("${baseUrl}/execute/calculator/${calculatorId}"))
    .header("X-API-Key", "${apiKey}")
    .header("Content-Type", "application/json")
    .POST(${bodyPublisher})
    .build();

var response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());`;
}

export function javaDescribe({ baseUrl, calculatorId, token }: SnippetParams): string {
	return `import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

var client = HttpClient.newHttpClient();
var request = HttpRequest.newBuilder()
    .uri(URI.create("${baseUrl}/calculator/${calculatorId}/describe"))
    .header("X-API-Key", "${apiKey}")
    .GET()
    .build();

var response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());`;
}

// --- Language registry ---

export interface Language {
	id: string;
	label: string;
	hljs: string;
	execute: (params: SnippetParams) => string;
	describe: (params: SnippetParams) => string;
}

export const languages: Language[] = [
	{ id: 'curl', label: 'curl', hljs: 'bash', execute: curlExecute, describe: curlDescribe },
	{ id: 'javascript', label: 'JavaScript', hljs: 'javascript', execute: jsExecute, describe: jsDescribe },
	{ id: 'python', label: 'Python', hljs: 'python', execute: pythonExecute, describe: pythonDescribe },
	{ id: 'php', label: 'PHP', hljs: 'php', execute: phpExecute, describe: phpDescribe },
	{ id: 'go', label: 'Go', hljs: 'go', execute: goExecute, describe: goDescribe },
	{ id: 'rust', label: 'Rust', hljs: 'rust', execute: rustExecute, describe: rustDescribe },
	{ id: 'java', label: 'Java', hljs: 'java', execute: javaExecute, describe: javaDescribe },
];
