# Databricks notebook source
# Deploy-triggered no-op task shared by all fixture jobs. Parameters are
# accepted but unused — the runs exist only to exercise job_runs lifecycles.
# Kept identical in before/ and after/ — each bundle root deploys its own copy.
print("deploy-triggered run complete")
