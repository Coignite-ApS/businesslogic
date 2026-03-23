export interface FormulaSnippetParams {
	baseUrl: string;
	apiKey: string;
}

export function maskToken(token: string): string {
	if (token.length <= 8) return '*'.repeat(token.length);
	return token.slice(0, 4) + '*'.repeat(token.length - 8) + token.slice(-4);
}

const singleBody = JSON.stringify({ formula: 'SUM(1,2,3)' }, null, 2);
const batchBody = JSON.stringify({ formulas: ['SUM(1,2,3)', 'AVERAGE(10,20,30)'] }, null, 2);
const sheetBody = JSON.stringify({ formulas: [{ cell: 'C1', formula: 'A1+B1' }], data: [[10, 20]] }, null, 2);

type Endpoint = 'single' | 'batch' | 'sheet';

function endpointPath(ep: Endpoint): string {
	if (ep === 'batch') return '/execute/batch';
	if (ep === 'sheet') return '/execute/sheet';
	return '/execute';
}

function sampleBody(ep: Endpoint): string {
	if (ep === 'batch') return batchBody;
	if (ep === 'sheet') return sheetBody;
	return singleBody;
}

// --- curl ---
function curl(ep: Endpoint, { baseUrl, apiKey }: FormulaSnippetParams): string {
	return `curl -X POST "${baseUrl}${endpointPath(ep)}" \\
  -H "X-API-Key: ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '${sampleBody(ep)}'`;
}

// --- JavaScript ---
function js(ep: Endpoint, { baseUrl, apiKey }: FormulaSnippetParams): string {
	return `const response = await fetch("${baseUrl}${endpointPath(ep)}", {
  method: "POST",
  headers: {
    "X-API-Key": "${apiKey}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify(${sampleBody(ep)}),
});

const result = await response.json();
console.log(result);`;
}

// --- Python ---
function python(ep: Endpoint, { baseUrl, apiKey }: FormulaSnippetParams): string {
	return `import requests

data = ${sampleBody(ep)}

response = requests.post(
    "${baseUrl}${endpointPath(ep)}",
    headers={"X-API-Key": "${apiKey}"},
    json=data
)

print(response.json())`;
}

// --- PHP ---
function php(ep: Endpoint, { baseUrl, apiKey }: FormulaSnippetParams): string {
	return `<?php
$ch = curl_init("${baseUrl}${endpointPath(ep)}");
$data = json_encode(${sampleBody(ep)});

curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "X-API-Key: ${apiKey}",
    "Content-Type: application/json",
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, $data);

$response = curl_exec($ch);
curl_close($ch);

echo $response;`;
}

// --- Go ---
function go(ep: Endpoint, { baseUrl, apiKey }: FormulaSnippetParams): string {
	return `package main

import (
	"fmt"
	"io"
	"net/http"
	"strings"
)

func main() {
	body := strings.NewReader(\`${sampleBody(ep)}\`)
	req, err := http.NewRequest("POST", "${baseUrl}${endpointPath(ep)}", body)
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

// --- Rust ---
function rust(ep: Endpoint, { baseUrl, apiKey }: FormulaSnippetParams): string {
	return `use reqwest;

#[tokio::main]
async fn main() -> Result<(), reqwest::Error> {
    let client = reqwest::Client::new();
    let res = client
        .post("${baseUrl}${endpointPath(ep)}")
        .header("X-API-Key", "${apiKey}")
        .json(&serde_json::json!(${sampleBody(ep)}))
        .send()
        .await?;

    let body = res.text().await?;
    println!("{}", body);
    Ok(())
}`;
}

// --- Java ---
function java(ep: Endpoint, { baseUrl, apiKey }: FormulaSnippetParams): string {
	return `import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

var client = HttpClient.newHttpClient();
var request = HttpRequest.newBuilder()
    .uri(URI.create("${baseUrl}${endpointPath(ep)}"))
    .header("X-API-Key", "${apiKey}")
    .header("Content-Type", "application/json")
    .POST(HttpRequest.BodyPublishers.ofString("""
            ${sampleBody(ep)}"""))
    .build();

var response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());`;
}

// --- Language registry ---

export interface Language {
	id: string;
	label: string;
	hljs: string;
	snippet: (ep: Endpoint, params: FormulaSnippetParams) => string;
}

export const languages: Language[] = [
	{ id: 'curl', label: 'curl', hljs: 'bash', snippet: curl },
	{ id: 'javascript', label: 'JavaScript', hljs: 'javascript', snippet: js },
	{ id: 'python', label: 'Python', hljs: 'python', snippet: python },
	{ id: 'php', label: 'PHP', hljs: 'php', snippet: php },
	{ id: 'go', label: 'Go', hljs: 'go', snippet: go },
	{ id: 'rust', label: 'Rust', hljs: 'rust', snippet: rust },
	{ id: 'java', label: 'Java', hljs: 'java', snippet: java },
];

export type { Endpoint };
