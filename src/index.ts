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
            if (auto_sleek) {
                container.appendChild(getToggleBtn(container));
            }

            formList[f].appendChild(container);
            ws = new Webservice(key, logger);

            ws.SchemaReceviedListener.on((e) => {
                if (auto_sleek) {
                    const inputs: WebFormComponents = new WebFormComponents('form-inputs');
                    const outputs: WebFormComponents = new WebFormComponents('form-outputs');

                    // When we create auto_sleek form first input elem is reflected in output panel
                    const firstInputKey = Object.keys(e.inputSchema.properties)[0];
                    const firstInputProperties = {...e.inputSchema.properties[firstInputKey]};
                    const firstInputComponentName = getInputComponentName(e, firstInputKey);

                    Object.keys(e.inputSchema.properties)
                        .forEach((param, index) => {
                            // When we create auto_sleek form first input is ignored for input panel
                            if (!index) return;
                            if (!e.inputSchema.properties.hasOwnProperty(param)) return;
                            const inputComponentName = getInputComponentName(e, param);

                            if (inputComponentName === 'range') {
                                inputs.attachComponent(inputComponentName, param, e.inputSchema.properties[param]);
                            } else {
                                inputs.attachComponent(inputComponentName, param);
                            }
                        })

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

                    // Add background image for auto_sleek form
                    if (auto_sleek && bg_image_url) {
                        outputs.setBgImgContainer(bg_image_url);
                    }

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

                    // Put first input component to output panel
                    if (firstInputComponentName === 'range') {
                        outputs.attachComponent(firstInputComponentName, firstInputKey, firstInputProperties);
                    } else {
                        outputs.attachComponent(firstInputComponentName, firstInputKey);
                    }

                    container.appendChild(outputs.webformComponents);
                }

                if (auto) {
                    let inputs: WebFormComponents = new WebFormComponents('form-inputs');
                    let outputs: WebFormComponents = new WebFormComponents('form-outputs');
                    let signature: WebFormComponents = new WebFormComponents();

                    for (let param in e.inputSchema.properties) {
                        if (!e.inputSchema.properties.hasOwnProperty(param)) return;

                        let type = e.inputSchema.properties[param].type;
                        let enumeration = e.inputSchema.properties[param].enum || e.inputSchema.properties[param].oneOf;

                        let isRange = e.inputSchema.properties[param].maximum &&
                            e.inputSchema.properties[param].minimum !== undefined &&
                            e.inputSchema.properties[param].type === 'number' &&
                            e.inputSchema.properties[param].default

                        if (enumeration) {
                            //TODO: We can already here generate dropdown options
                            inputs.attachComponent('select', param);
                        } else if (isRange) {
                            inputs.attachComponent('range', param, e.inputSchema.properties[param]);
                        } else {
                            switch (type) {
                                case 'number':
                                    inputs.attachComponent('number', param);
                                    break;
                                case 'integer':
                                    inputs.attachComponent('integer', param);
                                    break;
                                default:
                                    inputs.attachComponent('text', param);
                            }
                        }
                    }

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

                    container.appendChild(outputs.webformComponents);
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
