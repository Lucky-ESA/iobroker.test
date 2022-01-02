"use strict";

/*
 * Created with @iobroker/create-adapter v1.34.1
 * Based on https://github.com/nVuln/homebridge-lg-thinq
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const axios = require("axios");
const crypto = require("crypto");
const uuid = require("uuid");
const qs = require("qs");
const { DateTime } = require("luxon");
const { extractKeys } = require("./lib/extractKeys");
const constants = require("./lib/constants");
const { URL } = require("url");
//Neu Anfang
const dateFormat = require('dateformat');
//Neu Ende

class Test extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "test",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        this.setState("info.connection", false, true);
        if (this.config.interval < 0.5) {
            this.log.info("Set interval to minimum 0.5");
            this.config.interval = 0.5;
        }

//Neu Anfang
        this.monitoring        = false;
        this.dev               = {};
        this.dev["devID"]      = "NoDevice";
//Neu Ende

        // @ts-ignore
        this.requestClient = axios.create();
        this.updateInterval = null;
        this.session = {};
        this.modelInfos = {};
        this.auth = {};
        this.workIds = [];
        this.deviceControls = {};
//Neu Anfang
        this.deviceJson = {};
        this.courseJson = {};
        this.courseactual = {};
        this.lang = "de";
        await this.getForeignObject("system.config", async (err, data) => {
            if (data && data.common) {
                if (data.common.language !== this.lang) this.lang = "en";
            }
        });
        this.log.debug(this.lang);
//Neu Ende
        this.extractKeys = extractKeys;
        this.subscribeStates("*");
        this.targetKeys = {};

        this.defaultHeaders = {
            "x-api-key": constants.API_KEY,
            "x-client-id": constants.API_CLIENT_ID,
            "x-thinq-app-ver": "3.5.1700",
            "x-thinq-app-type": "NUTS",
            "x-thinq-app-level": "PRD",
            "x-thinq-app-os": "ANDROID",
            "x-thinq-app-logintype": "LGE",
            "x-service-code": "SVC202",
            "x-country-code": this.config.country,
            "x-language-code": this.config.language,
            "x-service-phase": "OP",
            "x-origin": "app-native",
            "x-model-name": "samsung / SM-N950N",
            "x-os-version": "7.1.2",
            "x-app-version": "3.5.1721",
            "x-message-id": this.random_string(22),
        };
        this.gateway = await this.requestClient
            .get(constants.GATEWAY_URL, { headers: this.defaultHeaders })
            .then((res) => res.data.result)
            .catch((error) => {
                this.log.error(error);
            });

        if (this.gateway) {
            this.lgeapi_url = `https://${this.gateway.countryCode.toLowerCase()}.lgeapi.com/`;

            this.session = await this.login(this.config.user, this.config.password).catch((error) => {
                this.log.error(error);
            });
            if (this.session && this.session.access_token) {
//Vor Ablauf erneuern Anfang
                this.session.expires_in = this.session.expires_in - 60;
//Vor Ablauf erneuern Ende
                this.log.debug(JSON.stringify(this.session));
                this.setState("info.connection", true, true);
                this.log.info("Login successful");
//Bitte löschen Anfang
                //this.refreshTokenInterval = setInterval(() => {
                //    this.refreshNewToken();
                //}, this.session.expires_in * 1000);
//Bitte löschen Ende
//Neu Anfang
                this.newrefreshTokenInterval(this.session.expires_in);
//Neu Ende
                this.userNumber = await this.getUserNumber();
                this.defaultHeaders["x-user-no"] = this.userNumber;
                this.defaultHeaders["x-emp-token"] = this.session.access_token;
                const listDevices = await this.getListDevices();

                this.log.info("Found: " + listDevices.length + " devices");
//Neu Anfang
                await this.setObjectNotExistsAsync("monitoringinfo", {
                    type: "channel",
                    common: {
                        name: "Info ThinQ2 Monitoring",
                        role: "state",
                    },
                    native: {},
                });
                await this.setObjectNotExists("monitoringinfo.last_update", {
                    type: "state",
                    common: {
                        name: "Timestamp last update - ThinQ2",
                        type: "number",
                        role: "indicator.date",
                        write: false,
                        read: true,
                    },
                    native: {},
                });
                await this.setObjectNotExists("monitoringinfo.monitoring_active", {
                    type: "state",
                    common: {
                        name: "Montitoring active - ThinQ2",
                        type: "boolean",
                        role: "indicator.state",
                        write: false,
                        read: true,
                        def: false,
                    },
                    native: {},
                });
                await this.setStateAsync("monitoringinfo.monitoring_active", {
                    val: false,
                    ack: true
                });
                await this.setObjectNotExists("monitoringinfo.monitoring_deviceID", {
                    type: "state",
                    common: {
                        name: "Montitoring deviceId - ThinQ2",
                        type: "string",
                        role: "indicator",
                        write: false,
                        read: true,
                        def: "",
                    },
                    native: {},
                });
                await this.setStateAsync("monitoringinfo.monitoring_deviceID", {
                    val: "",
                    ack: true
                });
//Neu Ende
                listDevices.forEach(async (element) => {
                    await this.setObjectNotExistsAsync(element.deviceId, {
                        type: "device",
                        common: {
                            name: element.alias,
                            role: "state",
                        },
                        native: {},
                    });
                    this.extractKeys(this, element.deviceId, element, null, false, true);
                    this.modelInfos[element.deviceId] = await this.getDeviceModelInfo(element);
                    await this.pollMonitor(element);
                    await this.sleep(2000);
                    this.extractValues(element);
                });

                this.log.debug(JSON.stringify(listDevices));
                this.updateInterval = setInterval(async () => {
                    await this.updateDevices();
                }, this.config.interval * 60 * 1000);
            }
        }
    }

    async newrefreshTokenInterval(times) {
        this.refreshTokenInterval = setInterval(() => {
            this.refreshNewToken();
        }, times * 1000);
    }

    async updateDevices() {
        const listDevices = await this.getListDevices().catch((error) => {
            this.log.error(error);
        });

        listDevices.forEach(async (element) => {
            this.extractKeys(this, element.deviceId, element);
            this.pollMonitor(element);
        });
        this.log.debug(JSON.stringify(listDevices));
    }

    async login(username, password) {
        // get signature and timestamp in login form
        const loginForm = await this.requestClient.get(await this.getLoginUrl()).then((res) => res.data);
        const headers = {
            Accept: "application/json",
            "X-Application-Key": constants.APPLICATION_KEY,
            "X-Client-App-Key": constants.CLIENT_ID,
            "X-Lge-Svccode": "SVC709",
            "X-Device-Type": "M01",
            "X-Device-Platform": "ADR",
            "X-Device-Language-Type": "IETF",
            "X-Device-Publish-Flag": "Y",
            "X-Device-Country": this.gateway.countryCode,
            "X-Device-Language": this.gateway.languageCode,
            "X-Signature": loginForm.match(/signature\s+:\s+"([^"]+)"/)[1],
            "X-Timestamp": loginForm.match(/tStamp\s+:\s+"([^"]+)"/)[1],
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        };

        const hash = crypto.createHash("sha512");
        const data = {
            user_auth2: hash.update(password).digest("hex"),
            itg_terms_use_flag: "Y",
            svc_list: "SVC202,SVC710", // SVC202=LG SmartHome, SVC710=EMP OAuth
        };

        // try login with username and hashed password
        const loginUrl = this.gateway.empTermsUri + "/" + "emp/v2.0/account/session/" + encodeURIComponent(username);
        const res = await this.requestClient
            .post(loginUrl, qs.stringify(data), { headers })
            .then((res) => res.data)
            .catch((err) => {
                if (!err.response) {
                    this.log.error(err);
                    return;
                }
                this.log.error(JSON.stringify(err.response.data));
                const { code, message } = err.response.data.error;
                if (code === "MS.001.03") {
                    this.log.error("Double-check your country in configuration");
                }
                if (code === "MS.001.16") {
                    this.log.error("Please check your app and accept new agreements");
                }
                return;
            });
        if (!res) {
            return;
        }
        // dynamic get secret key for emp signature
        const empSearchKeyUrl = this.gateway.empSpxUri + "/" + "searchKey?key_name=OAUTH_SECRETKEY&sever_type=OP";
        const secretKey = await this.requestClient
            .get(empSearchKeyUrl)
            .then((res) => res.data)
            .then((data) => data.returnData);

        const timestamp = DateTime.utc().toRFC2822();
        const empData = {
            account_type: res.account.userIDType,
            client_id: constants.CLIENT_ID,
            country_code: res.account.country,
            username: res.account.userID,
        };
        const empUrl = "/emp/oauth2/token/empsession" + qs.stringify(empData, { addQueryPrefix: true });
        const signature = this.signature(`${empUrl}\n${timestamp}`, secretKey);
        const empHeaders = {
            "lgemp-x-app-key": constants.OAUTH_CLIENT_KEY,
            "lgemp-x-date": timestamp,
            "lgemp-x-session-key": res.account.loginSessionID,
            "lgemp-x-signature": signature,
            Accept: "application/json",
            "X-Device-Type": "M01",
            "X-Device-Platform": "ADR",
            "Content-Type": "application/x-www-form-urlencoded",
            "Access-Control-Allow-Origin": "*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "en-US,en;q=0.9",
        };
        // create emp session and get access token
        const token = await this.requestClient
            .post("https://emp-oauth.lgecloud.com/emp/oauth2/token/empsession", qs.stringify(empData), {
                headers: empHeaders,
            })
            .then((res) => res.data)
            .catch((err) => {
                this.log.error(err.response.data.error.message);
                return;
            });
        if (token.status !== 1) {
            this.log.error(token.message);
            return;
        }

        this.lgeapi_url = token.oauth2_backend_url || this.lgeapi_url;

        return token;
    }

    async pollMonitor(device) {
        if (device.platformType === "thinq1") {
            this.log.debug("start polling");
            let result = new Uint8Array(1024);
            try {
                if (!(device.deviceId in this.workIds)) {
                    this.log.debug(device.deviceId + " is connecting");
                    await this.startMonitor(device);
                    await this.sleep(5000);
                }
                result = await this.getMonitorResult(device.deviceId, this.workIds[device.deviceId]);
                if (result && typeof result === "object") {
                    let resultConverted;
                    if (this.modelInfos[device.deviceId].Monitoring.type === "BINARY(BYTE)") {
                        resultConverted = this.decodeMonitorBinary(result, this.modelInfos[device.deviceId].Monitoring.protocol);
                    }
                    if (this.modelInfos[device.deviceId].Monitoring.type === "JSON") {
                        resultConverted = JSON.parse(result.toString("utf-8"));
                    }
                    this.log.debug(JSON.stringify(resultConverted));
                    await extractKeys(this, device.deviceId + ".snapshot", resultConverted);
                    return resultConverted;
                } else {
                    this.log.debug("No data:" + JSON.stringify(result) + " " + device.deviceId);
                }
                await this.stopMonitor(device);
            } catch (err) {
                this.log.error(err);
            }
        }
    }
    async startMonitor(device) {
        try {
            if (device.platformType === "thinq1") {
                const sendId = uuid.v4();
                const returnWorkId = await this.sendMonitorCommand(device.deviceId, "Start", sendId).then((data) => data.workId);
                this.workIds[device.deviceId] = returnWorkId;
            }
        } catch (err) {
            this.log.error(err);
        }
    }

    async stopMonitor(device) {
        if (device.platformType === "thinq1" && device.deviceId in this.workIds) {
            try {
                await this.sendMonitorCommand(device.deviceId, "Stop", this.workIds[device.deviceId]);
                delete this.workIds[device.deviceId];
            } catch (err) {
                this.log.error(err);
            }
        }
    }
    decodeMonitorBinary(data, protocol) {
        const decoded = {};

        for (const item of protocol) {
            const key = item.value;
            let value = 0;

            for (let i = item.startByte; i < item.startByte + item.length; i++) {
                const v = data[i];
                value = (value << 8) + v;
                decoded[key] = String(value);
            }
        }

        return decoded;
    }
    async refreshNewToken() {
        this.log.debug("refreshToken");
        const tokenUrl = this.lgeapi_url + "oauth2/token";
        const data = {
            grant_type: "refresh_token",
            refresh_token: this.session.refresh_token,
        };

        const timestamp = DateTime.utc().toRFC2822();

        const requestUrl = "/oauth2/token" + qs.stringify(data, { addQueryPrefix: true });
        const signature = this.signature(`${requestUrl}\n${timestamp}`, constants.OAUTH_SECRET_KEY);

        const headers = {
            "lgemp-x-app-key": constants.CLIENT_ID,
            "lgemp-x-signature": signature,
            "lgemp-x-date": timestamp,
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        };
        const resp = await this.requestClient
            .post(tokenUrl, qs.stringify(data), { headers })
            .then((resp) => resp.data)
            .catch((error) => {
                this.log.error(error);
            });
        this.log.debug(JSON.stringify(resp));
        if (this.session) {
            this.session.access_token = resp.access_token;
            this.defaultHeaders["x-emp-token"] = this.session.access_token;
//Neu set new interval Anfang
            this.session.expires_in = resp.expires_in - 60;
            clearInterval(this.refreshTokenInterval);
            this.newrefreshTokenInterval(this.session.expires_in);
//Neu set new interval Ende
        }
    }

    async getUserNumber() {
        const profileUrl = this.lgeapi_url + "users/profile";
        const timestamp = DateTime.utc().toRFC2822();
        const signature = this.signature(`/users/profile\n${timestamp}`, constants.OAUTH_SECRET_KEY);

        const headers = {
            Accept: "application/json",
            Authorization: "Bearer " + this.session.access_token,
            "X-Lge-Svccode": "SVC202",
            "X-Application-Key": constants.APPLICATION_KEY,
            "lgemp-x-app-key": constants.CLIENT_ID,
            "X-Device-Type": "M01",
            "X-Device-Platform": "ADR",
            "x-lge-oauth-date": timestamp,
            "x-lge-oauth-signature": signature,
        };

        const resp = await this.requestClient
            .get(profileUrl, { headers })
            .then((resp) => resp.data)
            .catch((error) => {
                this.log.error(error);
            });
        this.extractKeys(this, "general", resp);
        this.log.debug(JSON.stringify(resp));
        return resp.account.userNo;
    }

    async getLoginUrl() {
        const params = {
            country: this.gateway.countryCode,
            language: this.gateway.languageCode,
            client_id: constants.CLIENT_ID,
            svc_list: constants.SVC_CODE,
            svc_integrated: "Y",
            redirect_uri: this.gateway.empSpxUri + "/" + "login/iabClose",
            show_thirdparty_login: "LGE,MYLG",
            division: "ha:T20",
            callback_url: this.gateway.empSpxUri + "/" + "login/iabClose",
        };

        return this.gateway.empSpxUri + "/" + "login/signIn" + qs.stringify(params, { addQueryPrefix: true });
    }

    async sendMonitorCommand(deviceId, cmdOpt, workId) {
        const headers = Object.assign({}, this.defaultHeaders);
        headers["x-client-id"] = constants.API1_CLIENT_ID;
        const data = {
            cmd: "Mon",
            cmdOpt,
            deviceId,
            workId,
        };
        return await this.requestClient
            .post(this.gateway.thinq1Uri + "/" + "rti/rtiMon", { lgedmRoot: data }, { headers })
            .then((res) => res.data.lgedmRoot)
            .then((data) => {
                if ("returnCd" in data) {
                    const code = data.returnCd;
                    if (code === "0106") {
                        this.log.error(data.returnMsg || "");
                    } else if (code !== "0000") {
                        this.log.error(code + " - " + data.returnMsg || "");
                    }
                }
                this.log.debug(JSON.stringify(data));
                return data;
            })
            .catch((error) => {
                this.log.error(error);
            });
    }

    async getMonitorResult(device_id, work_id) {
        const headers = Object.assign({}, this.defaultHeaders);
        headers["x-client-id"] = constants.API1_CLIENT_ID;
        const workList = [{ deviceId: device_id, workId: work_id }];
        return await this.requestClient
            .post(this.gateway.thinq1Uri + "/" + "rti/rtiResult", { lgedmRoot: { workList } }, { headers })
            .then((resp) => resp.data.lgedmRoot)
            .then((data) => {
                if ("returnCd" in data) {
                    const code = data.returnCd;
                    if (code === "0106") {
                        return code;
                    } else if (code !== "0000") {
                        this.log.error(code + " - " + data.returnMsg || "");
                        return code;
                    }
                }
                this.log.debug(JSON.stringify(data));
                const workList = data.workList;
                if (!workList || workList.returnCode !== "0000") {
                    this.log.debug(JSON.stringify(data));
                    return null;
                }

                if (!("returnData" in workList)) {
                    return null;
                }

                return Buffer.from(workList.returnData, "base64");
            })
            .catch((error) => {
                this.log.error(error);
            });
    }

    signature(message, secret) {
        return crypto.createHmac("sha1", Buffer.from(secret)).update(message).digest("base64");
    }
    random_string(length) {
        const result = [];
        const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        const charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            result.push(characters.charAt(Math.floor(Math.random() * charactersLength)));
        }
        return result.join("");
    }
    resolveUrl(from, to) {
        const url = new URL(to, from);
        return url.href;
    }
    async getDeviceInfo(deviceId) {
        const headers = this.defaultHeaders;
        const deviceUrl = this.resolveUrl(this.gateway.thinq2Uri + "/", "service/devices/" + deviceId);

        return this.requestClient
            .get(deviceUrl, { headers })
            .then((res) => res.data.result)
            .catch((error) => {
                this.log.error("getDeviceInfo: " + error);
                if (error.response && error.response.status === 400) {
                    this.log.info("Try to refresh Token");
                    this.refreshNewToken();
                }
            });
    }

    async getDeviceEnergy(path) {
        const headers = this.defaultHeaders;
        const deviceUrl = this.resolveUrl(this.gateway.thinq2Uri + "/", path);

        return this.requestClient
            .get(deviceUrl, { headers })
            .then((res) => res.data.result)
            .catch((error) => {
                this.log.error("getDeviceEnergy: " + error);
                if (error.response && error.response.status === 400) {
                    this.log.info("Try to refresh Token");
                    //this.refreshNewToken();
                }
            });
    }

    async getListDevices() {
        if (!this.homes) {
            this.homes = await this.getListHomes();
            if (!this.homes) {
                this.log.error("Could not receive homes. Please check your app and accept new agreements");
                return [];
            }
            this.extractKeys(this, "homes", this.homes);
        }
        const headers = this.defaultHeaders;
        const devices = [];

        // get all devices in home
        for (let i = 0; i < this.homes.length; i++) {
            const homeUrl = this.resolveUrl(this.gateway.thinq2Uri + "/", "service/homes/" + this.homes[i].homeId);
            const resp = await this.requestClient
                .get(homeUrl, { headers })
                .then((res) => res.data)
                .catch((error) => {
                    this.log.debug("Failed to get home");
                    this.log.error(error);
                    if (error.response && error.response.data) {
                        this.log.error(JSON.stringify(error.response.data));
                    }
                    if (error.response && error.response.status === 400) {
                        this.log.info("Try to refresh Token");
                        this.refreshNewToken();
                    }
                    return;
                });

            this.log.debug(JSON.stringify(resp));
            if (resp) {
                this.log.debug(JSON.stringify(resp));
                devices.push(...resp.result.devices);
            }
        }

        return devices;
    }

    async getListHomes() {
        if (!this._homes) {
            const headers = this.defaultHeaders;
            const homesUrl = this.resolveUrl(this.gateway.thinq2Uri + "/", "service/homes");
            this._homes = await this.requestClient
                .get(homesUrl, { headers })
                .then((res) => res.data)
                .then((data) => data.result.item)
                .catch((error) => {
                    this.log.error(error);
                    error.response && this.log.error(JSON.stringify(error.response.data));
                });
        }

        return this._homes;
    }
    async getDeviceModelInfo(device) {
        if (!device.modelJsonUri) {
            return;
        }
        const deviceModel = await this.requestClient
            .get(device.modelJsonUri)
            .then((res) => res.data)
            .catch((error) => {
                this.log.error(error);
                return;
            });
        if (deviceModel) {
            await this.setObjectNotExistsAsync(device.deviceId + ".remote", {
                type: "channel",
                common: {
                    name: "remote control device",
                    role: "state",
                },
                native: {},
            });
            if (deviceModel["ControlWifi"]) {
                this.log.debug(JSON.stringify(deviceModel["ControlWifi"]));
                let controlWifi = deviceModel["ControlWifi"];
                if (deviceModel["ControlWifi"].action) {
                    controlWifi = deviceModel["ControlWifi"].action;
                }
                this.deviceControls[device.deviceId] = controlWifi;
//Neu Anfang
                this.deviceJson[device.deviceId] = deviceModel;
//Neu Ende
                const controlId = deviceModel["Info"].productType + "Control";
                await this.setObjectNotExistsAsync(device.deviceId + ".remote", {
                    type: "channel",
                    common: {
                        name: "remote control device",
                        role: "state",
                    },
                    native: {},
                });
//Neu Anfang
                await this.setObjectNotExists(device.deviceId + ".remote.Monitoring", {
                    type: "state",
                    common: {
                        name: constants[this.lang + "Translation"]["MON_DEVICE"],
                        type: "boolean",
                        role: "switch",
                        write: true,
                        read: true,
                        def: false,
                    },
                    native: {},
                }).catch((error) => {
                    this.log.error(error);
                });
                await this.setStateAsync(device.deviceId + ".remote.Monitoring", {
                    val: false,
                    ack: true
                });
//Neu Ende
                if (deviceModel["Info"].productType === "REF") {
//Neu Anfang
                    this.createStatistic(device.deviceId, 101);
//Neu Ende
                    await this.setObjectNotExists(device.deviceId + ".remote.fridgeTemp", {
                        type: "state",
                        common: {
                            name: "fridgeTemp_C",
                            type: "number",
                            write: true,
                            read: true,
                            role: "level",
                            desc: "Nur Celsius",
                            min: 1,
                            max: 7,
                            unit: "",
                            def: 1,
                            states: {
                                1: "7",
                                2: "6",
                                3: "5",
                                4: "4",
                                5: "3",
                                6: "2",
                                7: "1",
                            },
                        },
                        native: {},
                    });
                    await this.setObjectNotExists(device.deviceId + ".remote.freezerTemp", {
                        type: "state",
                        common: {
                            name: "freezerTemp_C",
                            type: "number",
                            write: true,
                            read: true,
                            role: "level",
                            desc: "Nur Celsius",
                            min: 1,
                            max: 11,
                            unit: "",
                            def: 1,
                            states: {
                                1: "-14",
                                2: "-15",
                                3: "-16",
                                4: "-17",
                                5: "-18",
                                6: "-19",
                                7: "-20",
                                8: "-21",
                                9: "-22",
                                10: "-23",
                                11: "-24",
                            },
                        },
                        native: {},
                    });
                    await this.setObjectNotExists(device.deviceId + ".remote.expressMode", {
                        type: "state",
                        common: {
                            name: "expressMode",
                            type: "boolean",
                            write: true,
                            read: true,
                            role: "state",
                            desc: "Expressmode",
                            def: false,
                            states: {
                                true: "EXPRESS_ON",
                                false: "OFF",
                            },
                        },
                        native: {},
                    });
                    await this.setObjectNotExists(device.deviceId + ".remote.ecoFriendly", {
                        type: "state",
                        common: {
                            name: "ecoFriendly",
                            type: "boolean",
                            write: true,
                            read: true,
                            role: "state",
                            desc: "Umweltfreundlich. Nicht fï¿½r alle verfï¿½gbar",
                            def: false,
                            states: {
                                true: "ON",
                                false: "OFF",
                            },
                        },
                        native: {},
                    });
                } else {
                    controlWifi &&
                        Object.keys(controlWifi).forEach((control) => {
//Geändet Anfang
                            if (control === "WMDownload") {
                                this.createremote(device.deviceId, control, deviceModel);
                            } else {
                                this.setObjectNotExists(device.deviceId + ".remote." + control, {
                                    type: "state",
                                    common: {
                                        name: control,
                                        type: "boolean",
                                        role: "boolean",
                                        write: true,
                                        read: true,
                                    },
                                    native: {},
                                });
                            }
                        });
//Geändet Ende
                }
            }
        }
        return deviceModel;
    }
//Neu Anfang
    createremote(devicedp, control, course) {
        try {
            let states = {};
            let dev    = "";
            this.courseJson[devicedp] = {};
            this.courseactual[devicedp] = {};
            if (control === "WMDownload") {
                this.lastDeviceCourse(devicedp);
                Object.keys(course["Course"]).forEach( async (value) => {
                    states[value] = (constants[this.lang + "Translation"][value]) ? constants[this.lang + "Translation"][value] : "Unbekannt";
                });
                Object.keys(course["SmartCourse"]).forEach( async (value) => {
                    states[value] = (constants[this.lang + "Translation"][value]) ? constants[this.lang + "Translation"][value] : "Unbekannt";
                });
                this.setObjectNotExists(devicedp + ".remote.Course", {
                    type: "channel",
                    common: {
                        name: constants[this.lang + "Translation"]["SEL_PROGRAM"],
                        role: "state",
                    },
                    native: {},
                }).catch((error) => {
                    this.log.error(error);
                });

                this.createStatistic(devicedp);

                this.setObjectNotExists(devicedp + ".remote.Favorite", {
                    type: "state",
                    common: {
                        name: constants[this.lang + "Translation"]["FAVORITE"],
                        type: "boolean",
                        role: "button",
                        write: true,
                        read: true,
                    },
                    native: {},
                }).catch((error) => {
                    this.log.error(error);
                });

                let common = {};
                dev = Object.keys(this.deviceControls[devicedp]["WMDownload"]["data"])[0];
                dev = this.deviceControls[devicedp]["WMDownload"]["data"][dev];
                Object.keys(dev).forEach( async (value) => {
                    common = {
                        name: "unbekannt",
                        type: "string",
                        role: "value",
                        write: true,
                        read: true,
                    }
                    states = {};
                    if (course["MonitoringValue"][value]) {
                        Object.keys(course["MonitoringValue"][value]["valueMapping"]).forEach( async (map) => {
                            if (map === "min" || map === "max") {
                                common[map] = (course["MonitoringValue"][value]["valueMapping"][map] !== 3) ? course["MonitoringValue"][value]["valueMapping"][map] : 0;
                                common["type"] = "number";
                                common["def"] = 0;
                            } else {
                                states[map] = (constants[this.lang + "Translation"][map]) ? constants[this.lang + "Translation"][map] : states[map]["value"];
                            }
                        });
                        common["name"] = (constants[this.lang + "Translation"][value]) ? constants[this.lang + "Translation"][value] : value;
                        if (Object.keys(states).length > 0) common["states"] = states;
                        this.courseJson[devicedp][value] = dev[value];
                        this.courseactual[devicedp][value] = dev[value];
                        await this.setObjectNotExistsAsync(devicedp + ".remote.Course." + value, {
                            type: "state",
                            common: common,
                            native: {},
                        }).catch((error) => {
                            this.log.error(error);
                        });
                    }
                });
            }
        } catch (e) {
            this.log.error("Error in valueinfolder: " + e);
        }
    }

    async createStatistic(devicedp, fridge) {
        await this.setObjectNotExists(devicedp + ".remote.Statistic", {
            type: "channel",
            common: {
                name: constants[this.lang + "Translation"]["STATISTIC"],
                role: "state",
            },
            native: {},
        }).catch((error) => {
            this.log.error(error);
        });

        if (fridge === 101) {
            this.setObjectNotExists(devicedp + ".remote.Statistic.command", {
                type: "state",
                common: {
                    name: constants[this.lang + "Translation"]["NAMEFRIDGE"],
                    type: "number",
                    role: "value",
                    write: true,
                    read: true,
                    def: 0,
                    states: {
                        "0": constants[this.lang + "Translation"]["F_DOOR"],
                        "1": constants[this.lang + "Translation"]["F_ENERGY"],
                        "2": constants[this.lang + "Translation"]["F_WATER"],
                        "3": constants[this.lang + "Translation"]["F_ACTIVE"],
                        "4": constants[this.lang + "Translation"]["F_FRIDGE"],
                        "5": constants[this.lang + "Translation"]["F_SELFCARE"],
                    },
                },
                native: {},
            }).catch((error) => {
                this.log.error(error);
            });
        }

        this.setObjectNotExists(devicedp + ".remote.Statistic.period", {
            type: "state",
            common: {
                name: constants[this.lang + "Translation"]["PERIOD"],
                type: "number",
                role: "value",
                write: true,
                read: true,
                def: 0,
                states: {
                    "0": constants[this.lang + "Translation"]["DAILY"],
                    "1": constants[this.lang + "Translation"]["MONTHLY"],
                    "2": constants[this.lang + "Translation"]["YEARLY"],
                },
            },
            native: {},
        }).catch((error) => {
            this.log.error(error);
        });

        this.setObjectNotExists(devicedp + ".remote.Statistic.startDate", {
            type: "state",
            common: {
                name: constants[this.lang + "Translation"]["STARTDATE"],
                type: "string",
                role: "value",
                write: true,
                read: true,
            },
            native: {},
        }).catch((error) => {
            this.log.error(error);
        });

        this.setObjectNotExists(devicedp + ".remote.Statistic.endDate", {
            type: "state",
            common: {
                name: constants[this.lang + "Translation"]["ENDDATE"],
                type: "string",
                role: "value",
                write: true,
                read: true,
            },
            native: {},
        }).catch((error) => {
            this.log.error(error);
        });

        this.setObjectNotExists(devicedp + ".remote.Statistic.jsonResult", {
            type: "state",
            common: {
                name: constants[this.lang + "Translation"]["JSONRESULT"],
                type: "string",
                role: "value",
                write: false,
                read: true,
            },
            native: {},
        }).catch((error) => {
            this.log.error(error);
        });

        this.setObjectNotExists(devicedp + ".remote.Statistic.sendRequest", {
            type: "state",
            common: {
                name: constants[this.lang + "Translation"]["SENDREQUEST"],
                type: "boolean",
                role: "button",
                write: true,
                read: true,
                def: false,
            },
            native: {},
        }).catch((error) => {
            this.log.error(error);
        });

    }
    async lastDeviceCourse(devId) {
        try {
            const devtype = await this.getStateAsync(devId + ".deviceType");
            const datacourse = await this.getDeviceEnergy("service/laundry/" + devId + "/energy-history?type=count&count=10&washerType=" + devtype + "&sorting=Y");
            if (datacourse !== undefined && Object.keys(datacourse["item"]).length > 0) {
                let states = {};
                let count  = 0;
                let name   = "";
                let startdate = "";
                let common = {
                    name: constants[this.lang + "Translation"]["LASTCOURSE"],
                    type: "number",
                    role: "value",
                    write: true,
                    read: true,
                    def: 0,
                };
                for (const items of Object.keys(datacourse["item"])) {
                    ++count;
                    name = null;
                    Object.keys(datacourse["item"][items]).forEach( async (keys) => {
                        if (keys === "timestamp") {
                            if (this.lang === "de") {
                                startdate = dateFormat(parseFloat(datacourse["item"][items][keys]), "yyyy-MM-dd HH:MM:ss");
                            } else {
                                startdate = dateFormat(parseFloat(datacourse["item"][items][keys]), "yyyy-mm-dd h:MM:ss  TT");
                            }
                            states[count] = startdate;
                        }
                        if (keys === "courseFL24inchBaseTitan") {
                            if (name === null)
                                name = (constants[this.lang + "Translation"][datacourse["item"][items][keys]]) ? constants[this.lang + "Translation"][datacourse["item"][items][keys]] : datacourse["item"][items][keys];
                        }
                        if (keys === "smartCourseFL24inchBaseTitan") {
                            if (datacourse["item"][items][keys] !== "NOT_SELECTED")
                                name = (constants[this.lang + "Translation"][datacourse["item"][items][keys]]) ? constants[this.lang + "Translation"][datacourse["item"][items][keys]] : datacourse["item"][items][keys];
                        }
                    });
                    states[count] += " - " +  name;
                }
                states["0"] = "NOT_SELECTED";
                common["desc"] = datacourse["item"];
                common["states"] = states;
                await this.setObjectNotExistsAsync(devId + ".remote.LastCourse", {
                    type: "state",
                    common: common,
                    native: {},
                    })
                    .catch((error) => {
                        this.log.error("LastCourse: " + error);
                });
                this.extendObject(devId + ".remote.LastCourse", {
                    common: common,
                });
                this.log.debug(JSON.stringify(states));
            } else {
                this.log.info("Not found washes!");
            }
        } catch (e) {
            this.log.error("lastDeviceCourse: " + JSON.stringify(datacourse) + " - Error: " + e);
        }
    }
//Neu Ende

    extractValues(device) {
        const deviceModel = this.modelInfos[device.deviceId];
        if (deviceModel["MonitoringValue"] || deviceModel["Value"]) {
            this.log.debug("extract values from model");
            let type = "";
            if (device["snapshot"]) {
                Object.keys(device["snapshot"]).forEach((subElement) => {
                    if (subElement !== "meta" && subElement !== "static" && typeof device["snapshot"][subElement] === "object") {
                        type = subElement;
                    }
                });
            }
            let path = device.deviceId + ".snapshot.";
            if (type) {
                path = path + type + ".";
            }
//Neu Start
            const onlynumber = /^-?[0-9]+$/;
//Neu Ende
            deviceModel["MonitoringValue"] &&
                Object.keys(deviceModel["MonitoringValue"]).forEach((state) => {
                    this.getObject(path + state, async (err, obj) => {
                        let common = {
                            name: state,
                            type: "mixed",
                            write: false,
                            read: true,
                        };
                        if (obj) {
                            common = obj.common;
                        }
//Bug Empty States Anfang
                        //common.states = {};
//Bug Empty States Ende
                        if (deviceModel["MonitoringValue"][state]["targetKey"]) {
                            this.targetKeys[state] = [];
                            const firstKeyName = Object.keys(deviceModel["MonitoringValue"][state]["targetKey"])[0];
                            const firstObject = deviceModel["MonitoringValue"][state]["targetKey"][firstKeyName];
                            Object.keys(firstObject).forEach((targetKey) => {
                                this.targetKeys[state].push(firstObject[targetKey]);
                            });
                        }
//Bug States Anfang
                        if (state === "courseFL24inchBaseTitan") {
                            Object.keys(deviceModel["Course"]).forEach( async (key) => {
                                common.states[key] = (constants[this.lang + "Translation"][key]) ? constants[this.lang + "Translation"][key] : "Unbekannt";
                            });
                                common.states["NOT_SELECTED"] = (constants[this.lang + "Translation"]["NOT_SELECTED"]) ? constants[this.lang + "Translation"]["NOT_SELECTED"] : 0;
                        }
                        if (state === "smartCourseFL24inchBaseTitan" ||
                            state === "downloadedCourseFL24inchBaseTitan") {
                                Object.keys(deviceModel["SmartCourse"]).forEach( async (key) => {
                                    common.states[key] = (constants[this.lang + "Translation"][key]) ? constants[this.lang + "Translation"][key] : "Unbekannt";
                                });
                                common.states["NOT_SELECTED"] = (constants[this.lang + "Translation"]["NOT_SELECTED"]) ? constants[this.lang + "Translation"]["NOT_SELECTED"] : 0;
                        }
                        if (deviceModel["MonitoringValue"][state]["valueMapping"]) {
                            if (deviceModel["MonitoringValue"][state]["valueMapping"].max) {
                                common.min = 0; // deviceModel["MonitoringValue"][state]["valueMapping"].min; //reseverdhour has wrong value
                                common.max = deviceModel["MonitoringValue"][state]["valueMapping"].max;
                            } else {
                                const values = Object.keys(deviceModel["MonitoringValue"][state]["valueMapping"]);
                                values.forEach((value) => {
                                    if (deviceModel["MonitoringValue"][state]["valueMapping"][value].label !== undefined) {
                                        const valueMap = deviceModel["MonitoringValue"][state]["valueMapping"][value];
                                        if (onlynumber.test(value)) {
                                            common.states[valueMap.index] = valueMap.label;
                                        } else {
                                            common.states[value] = valueMap.index;
                                        }
                                    } else {
                                        common.states[value] = value;
                                    }
//Bug States Ende
                                });
                            }
                        }
                        if (!obj) {
                            // @ts-ignore
                            await this.setObjectNotExistsAsync(path + state, {
                                type: "state",
                                common: common,
                                native: {},
                            }).catch((error) => {
                                this.log.error(error);
                            });
                        } else {
                            // @ts-ignore
                            this.extendObject(path + state, {
                                common: common,
                            });
                        }
                    });
                });
            deviceModel["Value"] &&
                Object.keys(deviceModel["Value"]).forEach((state) => {
                    this.getObject(path + state, async (err, obj) => {
                        if (obj) {
                            const common = obj.common;
                            common.states = {};
                            let valueObject = deviceModel["Value"][state]["option"];
                            if (deviceModel["Value"][state]["value_mapping"]) {
                                valueObject = deviceModel["Value"][state]["value_mapping"];
                            }
                            if (valueObject) {
                                if (valueObject.max) {
                                    common.min = 0; // deviceModel["MonitoringValue"][state]["valueMapping"].min; //reseverdhour has wrong value
                                    common.max = valueObject.max;
                                } else {
                                    const values = Object.keys(valueObject);
                                    values.forEach((value) => {
                                        const content = valueObject[value];
                                        if (typeof content === "string") {
                                            common.states[value] = content.replace("@", "");
                                        }
                                    });
                                }
                            }
                            // @ts-ignore
                            await this.setObjectNotExistsAsync(path + state, {
                                type: "state",
                                common: common,
                                native: {},
                            }).catch((error) => {
                                this.log.error(error);
                            });

                            // @ts-ignore
                            this.extendObject(path + state, {
                                common: common,
                            });
                        }
                    });
                });
        }
    }

    async sendCommandToDevice(deviceId, values, thinq1) {
        const headers = this.defaultHeaders;
        let controlUrl = this.resolveUrl(this.gateway.thinq2Uri + "/", "service/devices/" + deviceId + "/control-sync");
        let data = {
            ctrlKey: "basicCtrl",
            command: "Set",
            ...values,
        };
        if (thinq1) {
            controlUrl = this.gateway.thinq1Uri + "/" + "rti/rtiControl";
            data = values;
        }

       this.log.debug(JSON.stringify(data));

        return this.requestClient
            .post(controlUrl, data, { headers })
            .then((resp) => resp.data)
            .catch((error) => {
                this.log.error(error);
            });
    }
    sleep(ms) {
        return new Promise((resolve) => {
            this.sleepTimer = setTimeout(resolve, ms);
        });
    }
    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            this.updateInterval && clearInterval(this.updateInterval);
            this.refreshTokenInterval && clearInterval(this.refreshTokenInterval);
            this.refreshTimeout && clearTimeout(this.refreshTimeout);
            this.sleepTimer && clearTimeout(this.sleepTimer);
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async onStateChange(id, state) {
        if (state) {
            if (!state.ack) {
//Geändert Anfang
                const secsplit  = id.split('.')[id.split('.').length-2];
                const lastsplit = id.split('.')[id.split('.').length-1];
                const deviceId = id.split(".")[2];
                if (secsplit === "Course") {
                    this.courseactual[deviceId][lastsplit] = state.val;
                    this.log.debug(JSON.stringify(this.courseactual[deviceId]));
                    return;
                }

                if (secsplit === "Statistic") {
                    const devType = await this.checkObject(this.namespace + "." + deviceId + ".deviceType");
                    if (devType.val > 100 && devType.val < 104) this.sendStaticRequest(deviceId, true);
                    else this.sendStaticRequest(deviceId, false);
                    this.log.debug(JSON.stringify(this.courseactual[deviceId]));
                    return;
                }

                if (id.indexOf(".remote.") !== -1) {
                    let nofor    = true;
                    let action   = id.split(".")[4];
                    let data     = {};
                    let onoff    = "";
                    let response = "";
                    let rawData  = {};
                    let dev      = "";
                    if (["LastCourse", "Favorite", "Monitoring", "WMStart", "WMDownload", "fridgeTemp", "freezerTemp", "expressMode", "ecoFriendly"].includes(action)) {
                        const dataTemp = await this.getStateAsync(deviceId + ".snapshot.refState.tempUnit");
                        switch (action) {
                            case "fridgeTemp":
                                rawData.data = { refState: { fridgeTemp: state.val, tempUnit: dataTemp.val } };
                                action = "basicCtrl";
                                rawData.command = "Set";
                                break;
                            case "freezerTemp":
                                rawData.data = { refState: { freezerTemp: state.val, tempUnit: dataTemp.val } };
                                action = "basicCtrl";
                                rawData.command = "Set";
                                break;
                            case "expressMode":
                                onoff = state.val ? "EXPRESS_ON" : "OFF";
                                rawData.data = { refState: { expressMode: onoff, tempUnit: dataTemp.val } };
                                action = "basicCtrl";
                                rawData.command = "Set";
                                break;
                            case "ecoFriendly":
                                onoff = state.val ? "ON" : "OFF";
                                rawData.data = { refState: { ecoFriendly: onoff, tempUnit: dataTemp.val } };
                                action = "basicCtrl";
                                rawData.command = "Set";
                                break;
                            case "LastCourse":
                                this.setCourse(id, deviceId, state);
                                return;
                                break;
                            case "Favorite":
                                this.setFavoriteCourse(deviceId);
                                return;
                                break;
                            case "Monitoring":
                                let folder = "nok";
                                if (this.deviceJson[deviceId]["Config"]["targetRoot"] !== undefined) folder = this.deviceJson[deviceId]["Config"]["targetRoot"];
                                if (folder === "nok") {
                                    if (Object.keys(this.deviceJson[deviceId]["ControlWifi"])[0] !== undefined) {
                                        const wifi = Object.keys(this.deviceJson[deviceId]["ControlWifi"])[0];
                                        if (Object.keys(this.deviceJson[deviceId]["ControlWifi"][wifi]["data"])[0] !== undefined) {
                                            folder = Object.keys(this.deviceJson[deviceId]["ControlWifi"][wifi]["data"])[0];
                                        }
                                    }
                                }
                                if (folder === "nok") {
                                    this.log.warn("This device is not implemented");
                                    this.setStateAsync(id, {val: false, ack: true});
                                    return;
                                }
                                const objCount = await this.checkObject(this.namespace + "." + deviceId + ".snapshot." + folder);
                                if (objCount === 0) {
                                    this.log.error("Missing Folder: " + this.namespace + "." + deviceId + ".snapshot." + folder);
                                    return;
                                }
                                if (state.val) {
                                    if (this.monitoring) {
                                        this.log.warn("Only one device is allowed. Actual Device: " + this.dev["devID"]);
                                        await this.setStateAsync(id, {val: false, ack: true});
                                    } else if (this.dev["devID"] === "NoDevice") {
                                        this.monitoring = state.val;
                                        this.dev["devID"] = deviceId;
                                        this.log.info("Start device monitoring with DeviceID " + deviceId);
                                        this.dev["Monitor"] = {};
                                        this.deviceMonitor(deviceId, folder);
                                        await this.setStateAsync("monitoringinfo.monitoring_deviceID", {val: deviceId, ack: true});
                                        await this.setStateAsync("monitoringinfo.monitoring_active", {val: true, ack: true});
                                    } else {
                                        this.log.warn("Unknown error! Variable: " + this.monitoring + " DeviceId: " + deviceId + " Device: " + this.dev["devID"]);
                                        await this.setStateAsync(id, {val: false, ack: true});
                                    }
                                } else { 
                                    if (this.monitoring) {
                                        if (this.dev["devID"] !== deviceId && this.dev["devID"] !== "NoDevice") {
                                            this.log.warn("Please stop monitoring in device " + this.dev["devID"]);
                                        } else if (this.dev["devID"] === deviceId) {
                                            this.log.info("Stop monitoring device " + this.dev["devID"]);
                                            this.dev["devID"] = "NoDevice";
                                            this.dev["Monitor"] = {};
                                            this.monitoring = state.val;
                                            await this.setStateAsync("monitoringinfo.monitoring_deviceID", {val: "", ack: true});
                                            await this.setStateAsync("monitoringinfo.monitoring_active", {val: false, ack: true});

                                        } else {
                                            this.log.warn("Unknown error! Variable: " + this.monitoring + " DeviceId: " + deviceId + " Device: " + this.dev["devID"]);
                                        }
                                    } else {
                                        this.log.warn("Cannot find any current watch.");
                                        this.dev["devID"] = "NoDevice";
                                    }
                                }
                                return;
                                break;
                            case "WMDownload":
                                if (this.CheckUndefined(state.val, "Course", deviceId)) {
                                    this.InsertCourse(state.val, deviceId);
                                    return;
                                } else if (this.CheckUndefined(state.val, "SmartCourse", deviceId)) {
                                    rawData = this.deviceControls[deviceId][action];
                                    dev = Object.keys(this.deviceControls[deviceId][action]["data"])[0];
                                    let com = {};
                                    com = this.deviceJson[deviceId]["SmartCourse"][state.val].function;
                                    for(const val of com) {
                                        this.courseactual[deviceId][val["value"]] = val["default"];
                                    }
                                    rawData.data[dev] = {
                                        courseDownloadType: "COURSEDATA",
                                        courseDownloadDataLength: Object.keys(this.courseactual[deviceId]).length + 2,
                                        courseFL24inchBaseTitan: this.deviceJson[deviceId]["SmartCourse"][state.val].Course,
                                        downloadedCourseFL24inchBaseTitan: state.val,
                                        ...this.courseactual[deviceId],
                                    };
                                    this.InsertCourse(state.val, deviceId);
                                } else {
                                    this.log.warn("Command " + action + " and value " + state.val + " not found");
                                    return;
                                }
                                break;
                            case "WMStart":
                                rawData = this.deviceControls[deviceId][action];
                                dev = Object.keys(this.deviceControls[deviceId][action]["data"])[0];
                                const WMState = await this.getStateAsync(deviceId + ".remote.WMDownload");
                                if (JSON.stringify(WMState) === null || WMState === undefined) {
                                     this.log.warn("Datapoint MWDownload is empty!");
                                }
                                if (this.CheckUndefined(WMState.val, "Course", deviceId)) {
                                     rawData.data[dev] = {
                                        courseFL24inchBaseTitan: WMState.val,
                                        ...this.courseactual[deviceId],
                                    };
                                } else if (this.CheckUndefined(WMState.val, "SmartCourse", deviceId)) {
                                     rawData.data[dev] = {
                                        courseFL24inchBaseTitan: this.deviceJson[deviceId]["SmartCourse"][WMState.val].Course,
                                        smartCourseFL24inchBaseTitan: WMState.val,
                                        ...this.courseactual[deviceId],
                                    };
                                } else {
                                    this.log.warn("Command " + action + " and value " + state.val + " not found");
                                    return;
                                }
                                break;
                            default:
                                this.log.info("Command " + action + " not found");
                                return;
                                break;
                        }
                        nofor = false;
                        response = "";
                    } else {
                        rawData = this.deviceControls[deviceId][action];
                    }

                    data = { ctrlKey: action, command: rawData.command, dataSetList: rawData.data };
//Geändert Ende
                    if (action === "WMStop" || action === "WMOff") {
                        data.ctrlKey = "WMControl";
                    }

                    this.log.debug(JSON.stringify(data));
//Geändert Anfang
                    if (data.dataSetList && nofor) {
//Geändert Ende
                        const type = Object.keys(data.dataSetList)[0];
                        if (type) {
                            for (const dataElement of Object.keys(data.dataSetList[type])) {
                                if (!dataElement.startsWith("control")) {
                                    const dataState = await this.getStateAsync(deviceId + ".snapshot." + type + "." + dataElement);
                                    if (dataState) {
                                        data.dataSetList[dataElement] = dataState.val;
                                    }
                                }
                            }
                        }
                    }
                    if (data.command && data.dataSetList) {
                        this.log.debug(JSON.stringify(data));
                        response = await this.sendCommandToDevice(deviceId, data);
                    } else {
                        rawData.value = rawData.value.replace("{Operation}", state.val ? "Start" : "Stop");
                        data = {
                            lgedmRoot: {
                                deviceId: deviceId,
                                workId: uuid.v4(),
                                cmd: rawData.cmd,
                                cmdOpt: rawData.cmdOpt,
                                value: rawData.value,
                                data: "",
                            },
                        };

                        this.log.debug(JSON.stringify(data));
                        response = await this.sendCommandToDevice(deviceId, data, true);
                    }

                    this.log.debug(JSON.stringify(response));

                    if ((response && response.resultCode && response.resultCode !== "0000") || (response && response.lgedmRoot && response.lgedmRoot.returnCd !== "0000")) {
                        this.log.error("Command not succesful");
                        this.log.error(JSON.stringify(response));
                    }
                } else {
                    const object = await this.getObjectAsync(id);
                    const name = object.common.name;
                    const data = { ctrlKey: "basicCtrl", command: "Set", dataKey: name, dataValue: state.val };
                    if (name.indexOf(".operation") !== -1) {
                        data.command = "Operation";
                    }
                    this.log.debug(JSON.stringify(data));
                    const response = await this.sendCommandToDevice(deviceId, data);
                    this.log.debug(JSON.stringify(response));
                    if (response && response.resultCode !== "0000") {
                        this.log.error("Command not succesful");
                        this.log.error(JSON.stringify(response));
                    }
                }
                this.refreshTimeout = setTimeout(async () => {
                    await this.updateDevices();
                }, 10 * 1000);
            } else {
                const idArray = id.split(".");
                const lastElement = idArray.pop();
                if (this.targetKeys[lastElement]) {
                    this.targetKeys[lastElement].forEach((element) => {
                        this.setState(idArray.join(".") + "." + element, state.val, true);
                    });
                }
            }
        }
    }
//Neu Anfang
    async sendStaticRequest(device, fridge) {
        try {
            let statistic = null;
            const period  = await this.getStateAsync(device + ".remote.Statistic.period");
            let startD    = await this.getStateAsync(device + ".remote.Statistic.startDate");
            let endD      = await this.getStateAsync(device + ".remote.Statistic.endDate");
            let com       = "";
            if (fridge) com = await this.getStateAsync(device + ".remote.Statistic.command");
            let per = "day";
            if (!this.checkdate(startD) || !this.checkdate(endD)) {
                this.log.warn("Wrong date: Start: " + startD.val + " End: " + endD.val);
            }
            startD = this.checkdate(startD);
            endD = this.checkdate(endD);
            if (period === 1) per = "month";
            else if (period === 2) per = "year";
            this.log.debug("START " + startD);
            this.log.debug("END " + endD);
            this.log.debug(JSON.stringify(per));
            let lasturl = "period=" + per + "&startDate=" + startD + "&endDate=" + endD;
            if (!fridge) {
                statistic = await this.getDeviceEnergy("service/laundry/" + device + "/energy-history?type=period&" + lasturl);
            } else {
                device = "service/fridge/" + device + "/";
                if (com.val === 0)
                    statistic = await this.getDeviceEnergy(device + "door-open-history?" + lasturl);
                else if (com.val === 1)
                    statistic = await this.getDeviceEnergy(device + "energy-history?" + lasturl);
                else if (com.val === 2)
                    statistic = await this.getDeviceEnergy(device + "water-consumption-history?" + lasturl);
               else if (com.val === 3)
                    statistic = await this.getDeviceEnergy(device + "active-power-saving?" + lasturl + "&lgTotalAverageInfo=&version=2");
               else if (com.val === 4)
                    statistic = await this.getDeviceEnergy(device + "fridge-water-history?" + lasturl);
               else if (com.val === 5)
                    statistic = await this.getDeviceEnergy(device + "fridge-water-history?self-care?startDate=" + startD + "&endDate=" + endD);
            }
            if (statistic !== undefined && statistic !== null) {
                this.log.debug(JSON.stringify(statistic));
                await this.setStateAsync(device + ".remote.Statistic.jsonResult", {
                    val: JSON.stringify(statistic),
                    ack: true
                });
            }
//service/laundry/"+e.product.id+"/courses/used
//service/laundry/"+e.product.id+"/courses/"+r+"/favorite - POST
//service/laundry/"+c.product.id+"/courses/favorite  {"item":[{"courseId":"DUVET","date":"20211215110248","courseType":null,"param1":"","param2":null}]}
//service/laundry/"+e.product.id+"/energy-history?type=period&period="+(n||"month")+"&startDate="+r+"&endDate="+t
//service/laundry/"+e.product.id+"/energy-history?type=period&period=day&startDate=2021-12-01&endDate=2021-12-31
//service/laundry/"+e.product.id+"/energy-history?type=count&count="+t+"&washerType="+(o=o||"M")+"&sorting="+r {"count":0,"power":0,"energyWater":0,"energyDetergent":0,"energySoftener":0,"powerWh":0,"periodicEnergyData":0,"item":[{"timestamp":"1639913066652","courseSpendPower":"1","smartCourseFL24inchBaseTitan":"NOT_SELECTED","periodicEnergyData":"1","temp":"TEMP_30","courseFL24inchBaseTitan":"COTTON","spin":"SPIN_1600","rinse":"RINSE_NORMAL","dryLevel":"NOT_SELECTED","soilWash":"SOILWASH_NORMAL"}]}
//service/users/push/config
//service/users/push/config?deviceId="+e.product.id
//service/users/push/send
//service/devices/"+e.product.id+"/config
//service/devices/"+e.product.id+"/network-status
//service/devices/"+e.product.id+"/firmware
//service/devices/"+e.product.id
//service/fridge/"+e.product.id+"/smart-care/config?type=activeCooling&version=1";
//service/fridge/"+e.product.id+"/smart-care/config?type=smartSafety&version=2";
//service/fridge/"+e.product.id+"/night-mode";
//service/fridge/"+e.product.id+"/push/config/expired-food";
        } catch (e) {
            this.log.error("Error in sendStaticRequest: " + e);
        }
    }

    checkdate(value) {
        const onlynumber = /^-?[0-9]+$/;
        if (value.val === undefined) return false;
        let checkd = value.val.split(".");
        if (Object.keys(checkd).length !== 3) return false;
        if (checkd[0].toString().length !== 4  || !onlynumber.test(checkd[0])) return false;
        if (!onlynumber.test(checkd[1])) return false;
        if (checkd[1].toString().length !== 2) {
            if (checkd[1].toString().length === 1) {
                checkd[1] = "0" + checkd[1];
            } else {
                return false;
            }
        }
        if (!onlynumber.test(checkd[2])) return false;
        if (checkd[2].toString().length !== 2) {
            if (checkd[2].toString().length === 1) {
                checkd[2] = "0" + checkd[1];
            } else {
                return false;
            }
        }
        return checkd[0] + "-" + checkd[1] + "-" + checkd[2]
    }

    async setFavoriteCourse(device) {
        try {
            const favcourse = await this.getDeviceEnergy("service/laundry/" + device + "/courses/favorite");
            if (favcourse !== undefined && Object.keys(favcourse["item"]).length > 0) {
                const isonline = await this.getStateAsync(device + ".snapshot.online");
                if (isonline !== undefined) {
                    if (isonline.val) {
                        if (favcourse["item"]["courseId"] !== undefined) {
                            await this.setStateAsync(device + ".remote.WMDownload", {val: favcourse["item"]["courseId"], ack: false});
                            this.log.info("Set Favorite: " + (constants[this.lang + "Translation"][favcourse["item"]["courseId"]]) ? constants[this.lang + "Translation"][favcourse["item"]["courseId"]] : favcourse["item"]["courseId"]);
                        }
                    }
                }
            } else {
                this.log.error("No favorite set.");
            }
        } catch (e) {
            this.log.error("Error in setFavoriteCourse: " + e);
        }
    }

    async setCourse(id, device, state) {
        try {
            this.getForeignObject(id, async (err, obj) => {
                if (obj) {
                    const rawstring = obj.common.desc;
                    this.log.debug(JSON.stringify(rawstring) + " State: " + state.val);
                    if (Array.isArray(rawstring) && Object.keys(rawstring).length > 0) {
                        const rawselect = rawstring[state.val];
                        this.log.debug(JSON.stringify(rawstring) + " State: " + state.val);
                        if (rawselect.smartCourseFL24inchBaseTitan !== "NOT_SELECTED") {
                            await this.setStateAsync(device + ".remote.WMDownload", {
                                val: rawselect.smartCourseFL24inchBaseTitan,
                                ack: false
                            });
                            await this.sleep(1000);
                        } else {
                            await this.setStateAsync(device + ".remote.WMDownload", {
                                val: rawselect.courseFL24inchBaseTitan,
                                ack: false
                            });
                            await this.sleep(1000);
                        }
                        Object.keys(rawselect).forEach( async (value) => {
                            await this.getForeignObject(this.namespace + "." + device + ".remote.Course." + value, async (err, obj) => {
                                if (obj) {
                                    await this.setStateAsync(device + ".remote.Course." + value, {
                                        val: rawselect[value],
                                        ack: false
                                    });
                                    await this.sleep(200);
                                }
                            });
                        });
                    }
                }
            });
        } catch (e) {
            this.log.error("Error in setCourse: " + e);
        }
    }

    InsertCourse(state, device) {
        try {
            Object.keys(this.courseJson[device]).forEach( async (value) => {
                this.courseactual[device][value] = this.courseJson[device][value];
                await this.setStateAsync(device + ".remote.Course." + value, {
                    val: this.courseJson[device][value],
                    ack: true
                });
            });
            let com = {};
            if (this.CheckUndefined(state, "Course", device)) {
                com = this.deviceJson[device]["Course"][state].function;
            } else if (this.CheckUndefined(state, "SmartCourse", device)) {
                com = this.deviceJson[device]["SmartCourse"][state].function;
            } else {
                this.log.warn("Command " + action + " and value " + state.val + " not found");
                return;
            }
            for(const val of com) {
                this.getObject(device + ".remote.Course." + val["value"], async (err, obj) => {
                    if (obj) {
                        this.courseactual[device][val["value"]] = val["default"];
                        await this.setStateAsync(device + ".remote.Course." + val["value"], {
                            val: val["default"],
                            ack: true
                        });
                    }
                });
            }
        } catch (e) {
            this.log.error("Error in InsertCourse: " + e);
        }
    }

    CheckUndefined(value1, value2, value3) {
        try {
            if (this.deviceJson[value3][value2][value1]) return true;
        } catch (e) {
            return false;
        }
    }

    async deviceMonitor(devId, folder) {
        if (this.monitoring === false) return;
        try {
            const valuefolder = await this.getDeviceInfo(devId);
            if (valuefolder !== undefined) {
                this.log.debug(JSON.stringify(valuefolder["snapshot"][folder]));
                if (JSON.stringify(valuefolder["snapshot"][folder]) === JSON.stringify(this.dev["Monitor"])) {
                    this.log.debug("equal");
                } else {
                    this.log.debug("unequal");
                    this.dev["Monitor"] = valuefolder["snapshot"][folder];
                    for (const value of Object.keys(valuefolder["snapshot"][folder])) {
                        await this.setStateAsync(devId + ".snapshot." + folder + "." + value, {
                            val: valuefolder["snapshot"][folder][value],
                            ack: true
                        });
                    }
                }
            } else {
                await this.sleep(4000);
            }
            await this.setStateAsync("monitoringinfo.last_update", {
                val: Math.floor(new Date()),
                ack: true
            });
            await this.sleep(this.config.montime * 1000);
            this.deviceMonitor(devId, folder);
        } catch (e) {
            this.log.error("deviceMonitor: " + JSON.stringify(valuefolder) + " - Error: " + e);
            await this.sleep(this.config.montime * 1000);
            this.deviceMonitor(devId, folder);
        }
    }

    checkObject(channel) {
        return new Promise(resolve => {
            this.getForeignObjects(channel + '.*',(err, obj) => {
                if (err) {
                    this.log.debug("Read Object: " + err);
                    resolve(0);
                } else {
                    resolve(Object.keys(obj).length);
                }
            });
        });
    }
//Neu Ende
}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Test(options);
} else {
    // otherwise start the instance directly
    new Test();
}
