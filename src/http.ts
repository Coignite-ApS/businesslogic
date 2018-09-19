type Method = 'GET' | 'POST';

export class http {

    protected key: string;
    protected data: any;

    constructor(key:string) {
        this.key = key;
    }

    public makeRequest(method:Method, url:string, data?:any): Promise<any> {

        this.data = data || {};

        return new Promise((resolve: any, reject: any) => {

            let xhr = new XMLHttpRequest();

            xhr.open(method, url, true);

            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('X-Auth-Token', this.key);

            xhr.onload = function () {
                if (this.status >= 200 && this.status < 300) {
                    resolve(JSON.parse(xhr.response) || {});
                } else {
                    reject({
                        status: this.status,
                        statusText: xhr.statusText
                    });
                }
            };
            xhr.onerror = function () {
                reject({
                    status: this.status,
                    statusText: xhr.statusText
                });
            };
            xhr.send(JSON.stringify(this.data));
        });
    }
}