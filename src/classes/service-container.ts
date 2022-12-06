// Create dictonary for keeping track of all webservice instances
import {JSDict} from "../Helpers/TypedDictionary";
import {Webservice} from "./web-service";
// import {Webservice} from "../index";

export class ServiceContainer {
    private dict: any;

    constructor() {
        this.dict = JSDict.Create<string, Webservice>();
    }

    public add(apiKey: string, webservice: Webservice): void {
        if (!this.dict[apiKey]) {
            this.dict[apiKey] = webservice;
        } else {
            console.warn('Webservice with apiKey: ' + apiKey + ' was allready added to Businesslogic.Webservices');
        }
    }

    // TODO: Make this functions as a promise so you can be sure it is initialised
    // Remember to have a timeout resolve 30secs
    public get(apiKey: string): Webservice {
        return this.dict[apiKey];
    }
}
