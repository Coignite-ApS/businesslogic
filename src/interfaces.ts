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

export interface WebForm {
    name: string;
    form_el?:HTMLFormElement;
    inputs?: { [id: string]: {
            label_el?: Element;
            desc_el?: Element;
            input_el?: Element;
            err_el?: Element;
        }};
    controls?: { [id: string]: {
            control_el?: Element;
        }};
    outputs?: { [id: string]: {
            label_el?: Element;
            desc_el?: Element;
            output_el?: Element;
        }};
}

export interface WebFormErrors {
    [id: string]: string;
}

export interface IDictionary<Webservice> {
    [id: string]: Webservice;
}
