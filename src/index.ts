'use strict';

import {
    getFormConfiguration,
    getFormContainer,
    purgeForm,
    mapWebForm,
    getToggleBtn,
    getInputComponentName, getOutputComponentName
} from './utils';
import {Logger, WebFormComponents, Webservice} from './classes';


(function () {
    // See if we are in debug mode
    const debug = !!document.querySelector('script[bl-debug]');
    const logger = Logger.getInstance(debug);
    const formList = document.querySelectorAll('[bl-name]');

    logger.log('Initialise businesslogic');

    for (let f = 0; f < formList.length; f++) {
        let ws: Webservice;
        const [name, key, auto, auto_sleek, bg_image_url, submitLabel, resetLabel] = getFormConfiguration(formList[f]);

        if (auto || auto_sleek) {
            purgeForm(formList[f]);
            const container = getFormContainer();

            // Add toggle state btn for auto_sleek form
            if (auto_sleek) container.appendChild(getToggleBtn(container));

            formList[f].appendChild(container);
            ws = new Webservice(key, logger);

            ws.SchemaReceviedListener.on((e) => {
                let inputs: WebFormComponents = new WebFormComponents('form-inputs');
                let outputs: WebFormComponents = new WebFormComponents('form-outputs');
                let signature: WebFormComponents = new WebFormComponents();

                // For auto_sleek mode we set first input elem to output panel
                const firstInputKey = Object.keys(e.inputSchema.properties)[0];
                const firstInputProperties = {...e.inputSchema.properties[firstInputKey]};
                const firstInputComponentName = getInputComponentName(e, firstInputKey);

                Object.keys(e.inputSchema.properties)
                    .forEach((param, index) => {
                        // For auto_sleek mode we skip first input for input panel
                        if (auto_sleek && !index) return;
                        if (!e.inputSchema.properties.hasOwnProperty(param)) return;
                        const componentName = getInputComponentName(e, param);

                        if (componentName === 'select' ||
                            componentName === 'range' ||
                            componentName === 'number' ||
                            componentName === 'integer') {
                            inputs.attachComponent(componentName, param, e.inputSchema.properties[param]);
                        } else {
                            inputs.attachComponent('text', param);
                        }
                    });

                if (resetLabel !== null) {
                    inputs.attachComponent('submit-reset', null, {
                        submit: submitLabel,
                        reset: resetLabel
                    });
                } else {
                    inputs.attachComponent('submit', null, {
                        submit: submitLabel
                    });
                }

                container.appendChild(inputs.webformComponents);

                // Set background image for auto_sleek mode
                if (auto_sleek && bg_image_url) outputs.setBgImgContainer(bg_image_url);

                for (let param in e.outputSchema.properties) {
                    if (!e.outputSchema.properties.hasOwnProperty(param)) return;
                    let type = e.outputSchema.properties[param].type;
                    let enumeration = e.outputSchema.properties[param].enum || e.outputSchema.properties[param].oneOf;

                    if (enumeration) {
                        outputs.attachComponent('select', param);
                    } else {
                        switch (type) {
                            case 'number':
                                outputs.attachComponent('output', param);
                                break;
                            case 'integer':
                                outputs.attachComponent('output', param);
                                break;
                            //TODO: Consider how we can prepare placeholders for data in the output for an array
                            case 'array':
                                outputs.attachComponent('output-array', param, [{"name": 1}]);
                                break;
                            default:
                                outputs.attachComponent('output', param);
                        }
                    }
                }

                // For auto_sleek mode we set first input elem to output panel as the last elem
                if (auto_sleek) outputs.attachComponent(firstInputComponentName, firstInputKey, firstInputProperties);

                container.appendChild(outputs.webformComponents);

                if (!auto_sleek) {
                    signature.attachComponent('businesslogic');
                    formList[f].appendChild(signature.webformComponents);
                }

                const wf = mapWebForm(formList[f]);
                ws.assignWebForm(wf);
            });
        } else {
            ws = new Webservice(key, logger, mapWebForm(formList[f]));
        }

        logger.log('Creating form from template: ' + name);
    }
})();

// TODO: Consider implementing datalist with input instead of select https://www.quackit.com/html/tags/html_datalist_tag.cfm
// TODO: Consider supporting http://inorganik.github.io/countUp.js/
// TODO: Consider supporting https://nosir.github.io/cleave.js/
