import {SchemaReceivedEvent, WebForm} from './types';

export function isEmpty(obj: any) {
    for (let key in obj) {
        if (obj.hasOwnProperty(key))
            return false;
    }
    return true;
}

export function isConstructor(f: any) {
    try {
        new f();
    } catch (err) {
        // verify err is the expected error and then
        return false;
    }
    return true;
}

export function getFormConfiguration(form) {
    const name = form.getAttribute('bl-name');
    const key = form.getAttribute('bl-token');
    const auto = form.getAttribute('bl-auto') === '';
    const auto_sleek = form.getAttribute('bl-auto-sleek') === '';
    const bg_image_url = form.getAttribute('bl-background-image');
    const submitLabel = form.getAttribute('bl-control-submit-label');
    const resetLabel = form.getAttribute('bl-control-reset-label');

    return [name, key, auto, auto_sleek, bg_image_url, submitLabel, resetLabel];
}

export function purgeForm(form): void {
    form.querySelectorAll('*').forEach((o) => o.remove());
}

export function getFormContainer(): HTMLDivElement {
    const container: HTMLDivElement = document.createElement('div');
    container.classList.add('bl-form');
    container.classList.add('inputs-shown');

    return container;
}

export function getToggleBtn(formContainer) {
    const calcBtn = document.createElement('button');

    calcBtn.textContent = 'Hide calculator';
    calcBtn.addEventListener('click', () => {
        formContainer.classList.toggle('inputs-shown');
        const isInputsShown = formContainer.classList.contains('inputs-shown');
        calcBtn.textContent = isInputsShown ? 'Hide calculator' : 'Show calculator';
    });

    return calcBtn;
}

export function mapWebForm(formItem: any): WebForm {
    let name = formItem.getAttribute('bl-name');
    let key = formItem.getAttribute('bl-token');
    let inputs = formItem.querySelectorAll('[bl-input]');
    let controls = formItem.querySelectorAll('[bl-control]');
    let outputs = formItem.querySelectorAll('[bl-output]');
    let param: string, type: string, tagName: string;
    let el: Element;
    let lbl_el: Element, desc_el: Element, err_el: Element;


    let wf: WebForm = {
        name: name,
        inputs: {},
        controls: {},
        outputs: {}
    };

    if (formItem instanceof HTMLFormElement) {
        wf.form_el = formItem;
    }

    // Handling inputs
    for (let i = 0; i < inputs.length; i++) {
        param = inputs[i].getAttribute('bl-input');
        type = inputs[i].getAttribute('type');
        tagName = inputs[i].tagName;
        el = inputs[i];
        lbl_el = formItem.querySelector('[bl-input-label=' + param + ']');
        desc_el = formItem.querySelector('[bl-input-description=' + param + ']');
        err_el = formItem.querySelector('[bl-input-error=' + param + ']');
        wf.inputs[param] = {'label_el': lbl_el, 'desc_el': desc_el, 'input_el': el, 'err_el': err_el};
    }
    // Handling controls
    for (let i = 0; i < controls.length; i++) {
        param = controls[i].getAttribute('bl-control');
        type = controls[i].getAttribute('type');
        tagName = controls[i].tagName;
        el = controls[i];
        wf.controls[param] = {'control_el': el};
    }
    // Handling outputs
    for (let i = 0; i < outputs.length; i++) {
        param = outputs[i].getAttribute('bl-output');
        type = outputs[i].getAttribute('type');
        tagName = outputs[i].tagName;
        el = outputs[i];
        lbl_el = formItem.querySelector('[bl-output-label=' + param + ']');
        desc_el = formItem.querySelector('[bl-output-description=' + param + ']');
        wf.outputs[param] = {'label_el': lbl_el, 'desc_el': desc_el, 'output_el': el};
    }
    return wf;
}

export function getInputComponentName(e: SchemaReceivedEvent, param) {
    let type = e.inputSchema.properties[param].type;
    let enumeration = e.inputSchema.properties[param].enum || e.inputSchema.properties[param].oneOf;

    let isRange = e.inputSchema.properties[param].maximum &&
        e.inputSchema.properties[param].minimum !== undefined &&
        e.inputSchema.properties[param].type === 'number' &&
        e.inputSchema.properties[param].default;

    if (enumeration) return 'select';
    if (isRange) return 'range';
    return type;
}

export function getOutputComponentName(e: SchemaReceivedEvent, param) {
    let type = e.outputSchema.properties[param].type;
    let enumeration = e.outputSchema.properties[param].enum || e.outputSchema.properties[param].oneOf;

    if (enumeration) return 'select';
    return type;

    // if (enumeration) {
    //     outputs.attachComponent('select', param);
    // } else {
    //     switch (type) {
    //         case 'number':
    //             outputs.attachComponent('output', param);
    //             break;
    //         case 'integer':
    //             outputs.attachComponent('output', param);
    //             break;
    //         //TODO: Consider how we can prepare placeholders for data in the output for an array
    //         case 'array':
    //             outputs.attachComponent('output-array', param, [{"name": 1}]);
    //             break;
    //         default:
    //             outputs.attachComponent('output', param);
    //     }
    // }
}
