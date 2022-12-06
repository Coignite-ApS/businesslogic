// import {WebFormErrors} from "../WebForm";

import {WebFormErrors} from "./web-form";

export interface SchemaReceivedEvent {
    inputSchema: any;
    outputSchema: any;
    relatedData: any;
}

export interface ValidationFailedEvent {
    errors: WebFormErrors;
}

export interface DataChangedEvent {
    data: any;
}

export interface ExecutedEvent {
    data: any;
}

export interface Listener<T> {
    (event: T): any;
}

export interface Disposable {
    dispose():any;
}
