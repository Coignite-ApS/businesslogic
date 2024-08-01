export type WebForm = {
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

export type WebFormErrors = {
    [id: string]: string;
}

export type SchemaReceivedEvent = {
    inputSchema: any;
    outputSchema: any;
    relatedData: any;
}

export type ValidationFailedEvent = {
    errors: WebFormErrors;
}

export type DataChangedEvent = {
    data: any;
}

export type ExecutedEvent = {
    data: any;
}
