declare global {
    interface Window {
        Logix: ServiceContainer;
    }
}
export declare class Webservice {
    protected key: string;
    constructor(options?: any);
    getResult(): any;
}
export declare class ServiceContainer {
    private webServices;
    add(apiKey: string): void;
}
