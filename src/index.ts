'use strict';

//import { ServiceContainer } from './Webservices/Webservice';

export class Webservice {

    protected key: string;

    constructor(options: any = {}) {
        this.key = options.key || '';
        this.init();
    }

    private init() : void{
        Webservices.add(this.key,this);
    }

    public getResult(): any {


        let data = { "goal": 10000, "deadline": 2019 };

        let xhr = new XMLHttpRequest();

        let result = null;

        xhr.open('POST', 'https://api.businesslogic.online/execute', true);

        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('X-Auth-Token', this.key);

        xhr.onreadystatechange = function() {
            if(this.readyState === xhr.DONE && this.status == 200) {
                result = JSON.parse(this.responseText) || 'test';
                console.log(result)
                return result
            }
        };

        xhr.send(JSON.stringify(data));
    }
}

interface IDictionary<Webservice> {
    [id: string]: Webservice;
}

export class ServiceContainer {

    private dict: IDictionary<Webservice> = {};

    public add(apiKey:string, webservice:Webservice): void {
        if(!this.dict[apiKey]) this.dict[apiKey] = webservice;
    }

    public get(apiKey:string): Webservice {
        return this.dict[apiKey];
    }

}

let Webservices  = new ServiceContainer();

export default { Webservices };

(function (){
    console.log('Initialise businesslogic');
})();