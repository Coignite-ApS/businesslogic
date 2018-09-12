export class Businesslogic {

    constructor() {

    }

    public getResult(options: any = {}): any {
        // options
        options = options || {};

        // private data
        let key = options.key || '';

        let data = { "goal": 10000, "deadline": 2019 };

        let xhr = new XMLHttpRequest();

        let result = null;

        xhr.open('POST', 'https://api.businesslogic.online/execute', false);

        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('X-Auth-Token', key);

        xhr.onreadystatechange = function() {
            if(this.readyState === xhr.DONE && this.status == 200) {
                result = JSON.parse(this.responseText) || 'test';

                console.log('Test',result);
            }
        };

        xhr.send(JSON.stringify(data));

        return result
    }
}