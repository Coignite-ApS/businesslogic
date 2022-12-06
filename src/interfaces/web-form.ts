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
